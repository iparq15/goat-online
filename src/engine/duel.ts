// Duelo GOAT sobre ocgcore-wasm (motor de EDOPro). Sirve igual en el servidor (Durable
// Object) que en pruebas: crea el duelo, procesa hasta que alguien tenga que decidir y
// recibe las respuestas.

import {
  OcgDuelMode,
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgProcessResult,
  type OcgCoreSync,
  type OcgDuelHandle,
  type OcgMessage,
  type OcgResponse,
} from 'ocgcore-wasm';
import type { GoatData } from './data.ts';
import type { Deck } from './ydk.ts';
import type { DuelView, ViewCard, ViewPlayer } from '../protocol.ts';
import { canSee } from './visibility.ts';
import { OcgQueryFlags } from 'ocgcore-wasm';

export interface DuelSetup {
  decks: [Deck, Deck];
  /** 4 enteros de 64 bits (nunca todo ceros). Mismo seed + mismas respuestas = mismo duelo. */
  seed: [bigint, bigint, bigint, bigint];
  startingLP?: number;
}

/** Mensajes que piden una decisión a un jugador. */
const SELECT_TYPES = new Set<number>([
  OcgMessageType.SELECT_BATTLECMD,
  OcgMessageType.SELECT_IDLECMD,
  OcgMessageType.SELECT_EFFECTYN,
  OcgMessageType.SELECT_YESNO,
  OcgMessageType.SELECT_OPTION,
  OcgMessageType.SELECT_CARD,
  OcgMessageType.SELECT_CHAIN,
  OcgMessageType.SELECT_PLACE,
  OcgMessageType.SELECT_POSITION,
  OcgMessageType.SELECT_TRIBUTE,
  OcgMessageType.SORT_CHAIN,
  OcgMessageType.SELECT_COUNTER,
  OcgMessageType.SELECT_SUM,
  OcgMessageType.SELECT_DISFIELD,
  OcgMessageType.SORT_CARD,
  OcgMessageType.SELECT_UNSELECT_CARD,
  OcgMessageType.ROCK_PAPER_SCISSORS,
  OcgMessageType.ANNOUNCE_RACE,
  OcgMessageType.ANNOUNCE_ATTRIB,
  OcgMessageType.ANNOUNCE_CARD,
  OcgMessageType.ANNOUNCE_NUMBER,
]);

export function isSelectMessage(m: OcgMessage): boolean {
  return SELECT_TYPES.has(m.type);
}

export interface StepResult {
  /** Mensajes generados desde la última llamada (en orden). */
  messages: OcgMessage[];
  /** La decisión pendiente (si el duelo espera respuesta). */
  pending: OcgMessage | null;
  /** El duelo terminó. */
  ended: boolean;
  /** La última respuesta no era válida y hay que volver a decidir `pending`. */
  retry: boolean;
}

export class GoatDuel {
  private handle: OcgDuelHandle;
  private lastSelect: OcgMessage | null = null;
  private finished = false;
  readonly errors: string[] = [];
  /** Estado público que no se puede consultar al motor: LP, turno y fase. */
  readonly lp: [number, number];
  turn = 0;
  turnPlayer: 0 | 1 = 0;
  phase = 0;

  private core: OcgCoreSync;

  constructor(core: OcgCoreSync, data: GoatData, setup: DuelSetup) {
    this.core = core;
    const lp = setup.startingLP ?? 8000;
    this.lp = [lp, lp];
    const team = { startingLP: lp, startingDrawCount: 5, drawCountPerTurn: 1 };
    const handle = core.createDuel({
      flags: OcgDuelMode.MODE_GOAT,
      seed: setup.seed,
      team1: team,
      team2: team,
      cardReader: (code) => data.cards.get(code) ?? null,
      scriptReader: (name) => {
        const file = name.split('/').pop() ?? name;
        return data.scripts.get(file) ?? null;
      },
      errorHandler: (_type, text) => {
        this.errors.push(text);
      },
    });
    if (!handle) throw new Error('El motor no pudo crear el duelo.');
    this.handle = handle;

    // Scripts comunes que EDOPro carga siempre antes de empezar.
    for (const s of ['constant.lua', 'utility.lua']) {
      const src = data.scripts.get(s);
      if (src) core.loadScript(handle, s, src);
    }

    setup.decks.forEach((deck, team) => {
      const add = (code: number, location: OcgLocation) =>
        core.duelNewCard(handle, {
          team: team as 0 | 1,
          duelist: 0,
          code,
          controller: team as 0 | 1,
          location,
          sequence: 0,
          position: OcgPosition.FACEDOWN_DEFENSE,
        });
      for (const code of deck.main) add(code, OcgLocation.DECK);
      for (const code of deck.extra) add(code, OcgLocation.EXTRA);
    });
    core.startDuel(handle);
  }

  get ended(): boolean {
    return this.finished;
  }

  /** Avanza el duelo hasta que alguien tenga que decidir o termine. */
  step(): StepResult {
    const messages: OcgMessage[] = [];
    let retry = false;
    for (;;) {
      const status = this.core.duelProcess(this.handle);
      const batch = this.core.duelGetMessage(this.handle);
      for (const m of batch) {
        if (m.type === OcgMessageType.RETRY) {
          retry = true;
          continue;
        }
        messages.push(m);
        this.track(m);
        if (isSelectMessage(m)) this.lastSelect = m;
        if (m.type === OcgMessageType.WIN) this.finished = true;
      }
      if (status === OcgProcessResult.END || this.finished) {
        this.finished = true;
        return { messages, pending: null, ended: true, retry: false };
      }
      if (status === OcgProcessResult.WAITING) {
        return { messages, pending: this.lastSelect, ended: false, retry };
      }
    }
  }

  private track(m: OcgMessage): void {
    switch (m.type) {
      case OcgMessageType.NEW_TURN:
        this.turn++;
        this.turnPlayer = (m.player & 1) as 0 | 1;
        break;
      case OcgMessageType.NEW_PHASE:
        this.phase = m.phase;
        break;
      case OcgMessageType.LPUPDATE:
        this.lp[m.player] = m.lp;
        break;
      case OcgMessageType.DAMAGE:
      case OcgMessageType.PAY_LPCOST:
        this.lp[m.player] = Math.max(0, this.lp[m.player] - m.amount);
        break;
      case OcgMessageType.RECOVER:
        this.lp[m.player] += m.amount;
        break;
    }
  }

  /** ¿Está boca arriba la carta de esa zona? (para ocultar códigos en las decisiones). */
  isFaceUp(controller: number, location: number, sequence: number): boolean {
    const q = this.core.duelQuery(this.handle, {
      flags: OcgQueryFlags.POSITION,
      controller: controller as 0 | 1,
      location: location as OcgLocation,
      sequence,
      overlaySequence: 0,
    });
    return q?.position !== undefined && (q.position & OcgPosition.FACEUP) !== 0;
  }

  /** El duelo tal como lo ve `viewer` (solo información que puede conocer). */
  view(viewer: 0 | 1): DuelView {
    const flags =
      OcgQueryFlags.CODE |
      OcgQueryFlags.POSITION |
      OcgQueryFlags.ATTACK |
      OcgQueryFlags.DEFENSE |
      OcgQueryFlags.LEVEL |
      OcgQueryFlags.COUNTERS |
      OcgQueryFlags.IS_PUBLIC;
    const query = (controller: 0 | 1, location: OcgLocation) =>
      this.core.duelQueryLocation(this.handle, { flags: flags as OcgQueryFlags, controller, location });
    const card = (controller: 0 | 1, location: OcgLocation, q: NonNullable<ReturnType<typeof query>[number]>): ViewCard => {
      const position = q.position ?? 0;
      if (!canSee(viewer, controller, location, position, q.isPublic)) return { code: 0, position };
      const out: ViewCard = { code: q.code ?? 0, position };
      if (location === OcgLocation.MZONE) {
        out.attack = q.attack;
        out.defense = q.defense;
        out.level = q.level;
      }
      if (q.counters && Object.keys(q.counters).length) out.counters = q.counters;
      return out;
    };
    const zone = (controller: 0 | 1, location: OcgLocation, size: number) => {
      const list = query(controller, location);
      const out: (ViewCard | null)[] = [];
      for (let i = 0; i < size; i++) {
        const q = list[i];
        out.push(q && q.code !== undefined ? card(controller, location, q) : null);
      }
      return out;
    };
    const pile = (controller: 0 | 1, location: OcgLocation) =>
      query(controller, location)
        .filter((q): q is NonNullable<typeof q> => !!q)
        .map((q) => card(controller, location, q));
    const player = (p: 0 | 1): ViewPlayer => {
      const extra = pile(p, OcgLocation.EXTRA);
      return {
        lp: this.lp[p],
        deckCount: this.core.duelQueryCount(this.handle, p, OcgLocation.DECK),
        extraCount: extra.length,
        hand: pile(p, OcgLocation.HAND),
        monsters: zone(p, OcgLocation.MZONE, 5),
        spells: zone(p, OcgLocation.SZONE, 6),
        grave: pile(p, OcgLocation.GRAVE),
        banished: pile(p, OcgLocation.REMOVED),
        extra: p === viewer ? extra : [],
      };
    };
    const field = this.core.duelQueryField(this.handle);
    return {
      you: viewer,
      turn: this.turn,
      turnPlayer: this.turnPlayer,
      phase: this.phase,
      players: [player(0), player(1)],
      chain: field.chain.map((c) => ({ code: c.code, controller: c.controller, location: c.location, sequence: c.sequence })),
    };
  }

  respond(response: OcgResponse): void {
    this.core.duelSetResponse(this.handle, response);
  }

  destroy(): void {
    this.core.destroyDuel(this.handle);
  }
}
