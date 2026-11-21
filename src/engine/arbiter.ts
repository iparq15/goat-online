// Árbitro de un duelo: corre el motor y produce, para cada jugador, solo lo que puede ver.
// Lo usan el servidor (Durable Object, duelos online) y la app (duelo de práctica en el
// mismo móvil), así que los dos modos se comportan exactamente igual.

import { OcgMessageType, type OcgCoreSync, type OcgMessage, type OcgResponse } from 'ocgcore-wasm';
import type { GoatData } from './data.ts';
import { GoatDuel } from './duel.ts';
import { checkResponse } from './validate.ts';
import { filterEvent, sanitizePrompt } from './visibility.ts';
import type { Deck } from './ydk.ts';
import type { ServerMsg } from '../protocol.ts';

export type UpdateMsg = Extract<ServerMsg, { t: 'update' }>;

export interface DuelEnd {
  /** Equipo ganador (0 = el que empezó) o null si es empate. */
  winner: 0 | 1 | null;
  reason: string;
}

export type RespondResult =
  /** No le tocaba o era una respuesta antigua: se ignora. */
  | { kind: 'ignored' }
  /** Mal formada: no llegó al motor y hay que volver a pedir la decisión. */
  | { kind: 'invalid' }
  /** Aceptada (guardarla para poder reconstruir el duelo). */
  | { kind: 'accepted'; response: OcgResponse };

export class Arbiter {
  readonly duel: GoatDuel;
  /** Respuestas aceptadas hasta ahora (= número de la decisión actual). */
  responses = 0;
  pending: OcgMessage | null = null;
  retry = false;
  ended: DuelEnd | null = null;
  /** Eventos pendientes de enviar a cada equipo. */
  private outbox: [OcgMessage[], OcgMessage[]] = [[], []];

  /**
   * `decks[equipo]`: el equipo 0 es el que empieza. `replay`: respuestas ya dadas (para
   * reconstruir un duelo guardado; el motor es determinista).
   */
  constructor(core: OcgCoreSync, data: GoatData, decks: [Deck, Deck], seed: [bigint, bigint, bigint, bigint], replay: OcgResponse[] = []) {
    this.duel = new GoatDuel(core, data, { decks, seed });
    for (const r of replay) {
      this.duel.step();
      this.duel.respond(r);
      this.responses++;
    }
  }

  /** Avanza hasta la siguiente decisión (o el final) y acumula los eventos de cada equipo. */
  advance(): void {
    const r = this.duel.step();
    for (const m of r.messages) {
      for (const team of [0, 1] as const) {
        const f = filterEvent(team, m);
        if (f) this.outbox[team].push(f);
      }
    }
    this.retry = r.retry;
    this.pending = r.pending;
    if (r.ended) {
      const win = r.messages.find((m) => m.type === OcgMessageType.WIN) as { player: number; reason: number } | undefined;
      this.end(win ? ((win.player & 1) as 0 | 1) : null, winReason(win?.reason));
    }
  }

  /** Equipo que tiene que decidir ahora (null si nadie). */
  get waitingFor(): 0 | 1 | null {
    const p = this.pending;
    return !this.ended && p && 'player' in p ? ((p.player & 1) as 0 | 1) : null;
  }

  respond(team: 0 | 1, seq: number, raw: unknown): RespondResult {
    if (!this.pending || this.ended) return { kind: 'ignored' };
    if (this.waitingFor !== team || seq !== this.responses) return { kind: 'ignored' };
    const response = checkResponse(this.pending, raw);
    if (response) {
      try {
        this.duel.respond(response);
        this.responses++;
        this.retry = false;
        return { kind: 'accepted', response };
      } catch {
        /* cae a inválida */
      }
    }
    this.retry = true;
    return { kind: 'invalid' };
  }

  end(winner: 0 | 1 | null, reason: string): void {
    if (this.ended) return;
    this.ended = { winner, reason };
    this.pending = null;
  }

  surrender(team: 0 | 1): void {
    this.end(team === 0 ? 1 : 0, 'Surrender');
  }

  /** Actualización para `team`. `resync`: sin eventos (al reconectar o reconstruir). */
  update(team: 0 | 1, resync = false): UpdateMsg {
    const p = this.pending;
    const waitingFor = this.waitingFor;
    const duel = this.duel;
    return {
      t: 'update',
      seq: this.responses,
      view: duel.view(team),
      events: resync ? [] : this.outbox[team],
      prompt: p && waitingFor === team ? sanitizePrompt(team, p, (c, l, s) => duel.isFaceUp(c, l, s)) : null,
      waitingFor,
      retry: waitingFor === team && this.retry ? true : undefined,
    };
  }

  /** Descarta los eventos ya enviados. */
  flush(): void {
    this.outbox = [[], []];
  }

  destroy(): void {
    this.duel.destroy();
  }
}

export function winReason(r: number | undefined): string {
  switch (r) {
    case 0:
      return 'Surrender';
    case 1:
      return 'LP reached 0';
    case 2:
      return 'Deck out';
    case 3:
      return 'Time out';
    case 4:
      return 'Disconnection';
    default:
      return r !== undefined && r >= 0x10 ? 'Win by card effect' : 'Duel ended';
  }
}

/** Seed aleatorio de 256 bits (nunca todo ceros). */
export function randomSeed(): [bigint, bigint, bigint, bigint] {
  const rnd = new BigUint64Array(4);
  crypto.getRandomValues(rnd);
  if (rnd.every((x) => x === 0n)) rnd[0] = 1n;
  return [...rnd] as [bigint, bigint, bigint, bigint];
}
