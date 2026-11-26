// Pantalla de duelo de UN jugador. Recibe los mismos mensajes que mandaría el servidor
// (src/protocol.ts) y responde a las decisiones. Sirve igual para el duelo local (práctica)
// que para el online.

import { OcgMessageType, OcgResponseType, type OcgMessage, type OcgResponse } from 'ocgcore-wasm';
import type { DuelView, ServerMsg, ViewCard } from '../protocol.ts';
import type { DuelLink } from './local-host.ts';
import { bigCard, cardInfoHtml, miniCard } from './card-view.ts';
import { Fx, type Box } from './fx.ts';
import { settings, updateSettings } from './settings.ts';
import { play, type Sfx } from './sfx.ts';

/** Prioridad de los sonidos (si hay varios en una actualización suena el primero). */
const SFX_ORDER: Sfx[] = ['damage', 'attack', 'activate', 'summon', 'set', 'turn', 'heal', 'draw'];
import {
  allPoolCodes,
  attributeName,
  cardName,
  counterName,
  descText,
  esc,
  fmt,
  LOCATION_NAME,
  PHASES,
  phaseKey,
  POSITION_NAME,
  raceName,
  sys,
} from './text.ts';

type Update = Extract<ServerMsg, { t: 'update' }>;
type Prompt = OcgMessage;

interface Action {
  label: string;
  run: () => void;
}

interface Place {
  player: number;
  location: number;
  sequence: number;
}

type Sheet = { kind: 'detail'; key: string } | { kind: 'pile'; key: string } | { kind: 'log' } | { kind: 'menu' } | { kind: 'chain' } | null;

export interface ClientOptions {
  /** [tu nombre, nombre del rival] */
  names: [string, string];
  /** Duelo local: los dos jugadores están en este móvil. */
  hotseat?: boolean;
  /** Mismo móvil: asiento de este cliente (0 = Player 1, 1 = Player 2). */
  seat?: number;
  onExit: () => void;
  /** Cambió algo (para el modo de dos jugadores en el mismo móvil). */
  onChange?: () => void;
}

const key = (controller: number, location: number, sequence: number) => `${controller}:${location}:${sequence}`;
const bitsOf = (mask: number | bigint): number[] => {
  const out: number[] = [];
  const m = BigInt(mask);
  for (let i = 0n; i < 64n; i++) if ((m >> i) & 1n) out.push(Number(i));
  return out;
};

export class DuelClient {
  readonly el: HTMLElement;
  private link: DuelLink;
  private opts: ClientOptions;
  private u: Update | null = null;
  private ended: { winner: 0 | 1 | null; reason: string } | null = null;
  private logLines: string[] = [];
  private ticker = '';
  private reveal: number[] = [];
  private selectHint: bigint | null = null;
  private sheet: Sheet = null;
  private modalHidden = false;
  private sent = false;
  private picks: number[] = [];
  private places: Place[] = [];
  private counters: number[] = [];
  private flashes = new Set<string>();
  private lpFx: { player: number; text: string; cls: string }[] = [];
  private banner = '';
  private handlers = new Map<string, () => void>();
  private hid = 0;
  private zoneActions = new Map<string, Action[]>();
  /** Selección de cartas: mostrar la lista (ventana) en vez de elegir en el tablero. */
  private listMode = false;
  private placeable = new Map<string, Place>();
  private announceQuery = '';
  private endHidden = false;
  /** Sonido pendiente de esta actualización (el de más prioridad). */
  private sound: Sfx | null = null;
  /** Estado de la red (solo online). */
  private reconnecting = false;
  private opp: { connected: boolean; away?: boolean; forfeitAt?: number } | null = null;
  private timer = 0;
  visible = true;
  private inbox: ServerMsg[] = [];
  private busy = false;
  /** La actualización en curso ya se animó (los sonidos de activar/atacar/daño ya sonaron). */
  private animatedNow = false;
  private fx: Fx;

  constructor(el: HTMLElement, link: DuelLink, opts: ClientOptions) {
    this.el = el;
    this.link = link;
    this.opts = opts;
    this.fx = new Fx(el, () => (settings().anim === 'fast' ? 0.55 : 1));
    el.classList.add('duel');
    el.addEventListener('click', (e) => this.onClick(e));
    el.addEventListener('input', (e) => this.onInput(e));
    // Cuenta atrás del aviso de desconexión.
    this.timer = window.setInterval(() => {
      const b = this.el.querySelector('.netbanner');
      if (b) b.textContent = this.netText();
    }, 1000);
    this.render();
  }

  destroy(): void {
    clearInterval(this.timer);
  }

  /** Conexión con el servidor perdida (true) o recuperada (false). */
  setReconnecting(on: boolean): void {
    if (this.reconnecting === on) return;
    this.reconnecting = on;
    this.render();
  }

  private netText(): string {
    if (this.ended) return '';
    if (this.reconnecting) return 'Connection lost · reconnecting…';
    const o = this.opp;
    if (o && !o.connected) {
      if (!o.forfeitAt) return `${this.opts.names[1]} left.`;
      const s = Math.max(0, Math.round((o.forfeitAt - Date.now()) / 1000));
      return `${this.opts.names[1]} disconnected · you win in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} if they don't return`;
    }
    if (o?.away) return `${this.opts.names[1]} switched apps · waiting…`;
    return '';
  }

  /** ¿Te toca decidir ahora? */
  get deciding(): boolean {
    return !!this.u?.prompt && !this.sent && !this.ended;
  }

  /** Reproduciendo animaciones (todavía no se muestra la decisión). */
  get animating(): boolean {
    return this.busy;
  }

  get view(): DuelView | null {
    return this.u?.view ?? null;
  }

  // ---------- mensajes del servidor ----------

  /** Los mensajes se procesan en orden; las actualizaciones se animan si la pantalla se ve. */
  handle(m: ServerMsg): void {
    this.inbox.push(m);
    if (!this.busy) void this.pump();
  }

  private async pump(): Promise<void> {
    this.busy = true;
    try {
      while (this.inbox.length) {
        const m = this.inbox.shift()!;
        const prev = this.u;
        const animate = m.t === 'update' && !!prev && this.visible && settings().anim !== 'off' && !this.ended;
        if (animate) await this.animateBefore(prev!, m as Update).catch(() => {});
        this.animatedNow = animate;
        this.process(m);
        this.animatedNow = false;
        if (animate) await this.animateAfter(prev!, m as Update).catch(() => {});
      }
    } finally {
      this.busy = false;
    }
    this.render();
    this.opts.onChange?.();
  }

  // ---------- animaciones ----------

  private zoneKey(c: { controller: number; location: number; sequence: number }): string {
    return c.location === 256 ? key(c.controller, 8, 5) : key(c.controller, c.location, c.sequence);
  }

  /** Destino visual de una carta que sale del campo. */
  private destBox(controller: number, location: number): Box | null {
    const me = this.u?.view.you ?? 0;
    let el: HTMLElement | null = null;
    if (location === 16 || location === 1 || location === 64) el = this.fx.pile(`${controller}:${location}`);
    else if (location === 32) el = this.fx.pile(`${controller}:32`);
    else if (location === 2) el = this.el.querySelector<HTMLElement>(controller === me ? '.hand' : '.pbar.opp');
    return el ? this.fx.box(el) : null;
  }

  /** Animaciones sobre el tablero ANTERIOR: activar, atacar, destruir, barajar, daño, turno. */
  private async animateBefore(prev: Update, m: Update): Promise<void> {
    const T = OcgMessageType;
    const me = prev.view.you;
    const evs = m.events;
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      switch (ev.type) {
        case T.NEW_TURN: {
          const mine = (ev.player & 1) === me;
          const title = this.opts.hotseat ? `${esc(this.nameOf(ev.player & 1)).toUpperCase()}'S TURN` : mine ? 'YOUR TURN' : "OPPONENT'S TURN";
          play('turn');
          await this.fx.banner(title, `TURN ${m.view.turn}`, mine);
          break;
        }
        case T.CHAINING:
          play('activate');
          await this.fx.activate(bigCard(ev.code), ev.chain_size > 1 ? `CHAIN LINK ${ev.chain_size}` : 'ACTIVATE', ev.controller === me);
          break;
        case T.ATTACK: {
          const attacker = this.fx.zone(this.zoneKey(ev.card));
          if (!attacker) break;
          let target: Box | null = null;
          if (ev.target) {
            const t = this.fx.zone(this.zoneKey(ev.target));
            if (t) target = this.fx.box(t);
          } else {
            const defender = 1 - ev.card.controller;
            const bar = this.el.querySelector<HTMLElement>(defender === me ? '.pbar.me' : '.pbar.opp');
            if (bar) target = this.fx.box(bar);
          }
          play('attack');
          if (target) await this.fx.attack(attacker, target);
          break;
        }
        case T.MOVE: {
          // Cartas que salen del campo; las consecutivas se animan a la vez (p. ej. Heavy Storm).
          // Las que van de la mano o del mazo al cementerio se enseñan un momento (descartes,
          // costes, Graceful Charity…) y caen en él.
          const group: Promise<void>[] = [];
          const shown: { html: string; to: Box | null; controller: number }[] = [];
          const graves = new Set<number>();
          let fromHand = false;
          let j = i;
          for (; j < evs.length; j++) {
            const mv = evs[j];
            if (mv.type !== T.MOVE) break;
            const from = mv.from.location;
            const to = mv.to.location;
            if (to === 16) graves.add(mv.to.controller);
            if ((from === 4 || from === 8) && to !== 4 && to !== 8) {
              const z = this.fx.zone(this.zoneKey(mv.from));
              if (!z) continue;
              const destroyed = (mv.reason & 0x1) !== 0;
              group.push(destroyed ? this.fx.shatter(z) : this.fx.fly(z, this.destBox(mv.to.controller, to)));
            } else if ((from === 2 || from === 1) && to === 16 && mv.card) {
              shown.push({ html: miniCard(mv.card), to: this.destBox(mv.to.controller, 16), controller: mv.to.controller });
              if (from === 2) fromHand = true;
            }
          }
          i = j - 1;
          if (group.length || shown.length || graves.size) play('grave');
          if (group.length) await Promise.all(group);
          if (shown.length) {
            const mine = shown.every((c) => c.controller === me);
            const who = this.opts.hotseat || mine ? '' : "OPPONENT'S ";
            const label = fromHand ? `${who}DISCARD` : `${who}SENT TO GY`;
            await this.fx.toGrave(shown, label, mine || !!this.opts.hotseat);
          }
          await Promise.all([...graves].map((p) => this.fx.pile(`${p}:16`)).filter((e): e is HTMLElement => !!e).map((e) => this.fx.pulse(e)));
          break;
        }
        case T.DAMAGE: {
          const field = this.el.querySelector<HTMLElement>('.field');
          play('damage');
          if (field) await this.fx.damage(field);
          break;
        }
        case T.SHUFFLE_DECK: {
          const pile = this.fx.pile(`${ev.player}:1`);
          if (pile) await this.fx.shuffle(pile);
          break;
        }
        case T.SHUFFLE_HAND:
          if (ev.player === me) await this.fx.shuffleHand([...this.el.querySelectorAll<HTMLElement>('.hand .card')]);
          break;
        case T.CHAIN_NEGATED:
        case T.CHAIN_DISABLED:
          await this.fx.stamp('NEGATED', 'neg');
          break;
        case T.TOSS_COIN:
          await this.fx.stamp(ev.results.map((r) => (r ? 'HEADS' : 'TAILS')).join(' · '), 'coin');
          break;
        case T.TOSS_DICE:
          await this.fx.stamp(`DICE ${ev.results.join(' · ')}`, 'coin');
          break;
      }
    }
  }

  /** Animaciones sobre el tablero NUEVO: invocaciones, cartas colocadas, robos y LP. */
  private async animateAfter(prev: Update, m: Update): Promise<void> {
    const T = OcgMessageType;
    const me = m.view.you;
    const all: Promise<void>[] = [];
    let drawn = 0;
    for (const ev of m.events) {
      if (ev.type === T.SUMMONING || ev.type === T.SPSUMMONING || ev.type === T.FLIPSUMMONING || ev.type === T.SET) {
        if (ev.type === T.SET && ev.location !== 4 && ev.location !== 8) continue;
        const z = this.fx.zone(this.zoneKey(ev));
        if (!z) continue;
        const kind = ev.type === T.SUMMONING ? 'summon' : ev.type === T.SPSUMMONING ? 'special' : ev.type === T.FLIPSUMMONING ? 'flip' : 'set';
        all.push(this.fx.appear(z, kind));
      } else if (ev.type === T.DRAW && ev.player === me) drawn += ev.drawn.length;
    }
    if (drawn) {
      const hand = [...this.el.querySelectorAll<HTMLElement>('.hand .card')];
      all.push(this.fx.draw(hand.slice(-drawn), this.fx.pile(`${me}:1`)));
    }
    // LP que cambian: el número baja o sube poco a poco.
    for (const p of [0, 1] as const) {
      const before = prev.view.players[p].lp;
      const after = m.view.players[p].lp;
      if (before === after) continue;
      const el = this.el.querySelector<HTMLElement>(`${p === me ? '.pbar.me' : '.pbar.opp'} .lp b`);
      if (el) this.fx.tweenNumber(el, before, after);
    }
    await Promise.all(all);
  }

  private process(m: ServerMsg): void {
    switch (m.t) {
      case 'update':
        this.onUpdate(m);
        break;
      case 'ended':
        if (!this.ended && this.visible) play(this.opts.hotseat || m.winner === this.u?.view.you ? 'win' : 'lose');
        this.ended = { winner: m.winner, reason: m.reason };
        this.log(m.winner === null ? 'The duel ended in a draw.' : `${this.nameOf(m.winner)} wins (${m.reason}).`);
        this.sheet = null;
        break;
      case 'error':
        this.log(`Error: ${m.message}`);
        break;
      case 'opponent': {
        if (m.name) this.opts.names[1] = m.name;
        const prev = this.opp;
        this.opp = { connected: m.connected, away: m.away, forfeitAt: m.forfeitAt };
        const who = m.name ?? 'Your opponent';
        if (!prev || prev.connected !== m.connected) this.log(m.connected ? `${who} is connected.` : `${who} disconnected.`);
        else if (!!prev.away !== !!m.away) this.log(m.away ? `${who} switched to another app.` : `${who} is back.`);
        break;
      }
      default:
        return;
    }
    this.render();
    this.opts.onChange?.();
  }

  private onUpdate(m: Update): void {
    const prevPrompt = this.u?.prompt;
    this.u = m;
    this.sent = false;
    this.reveal = [];
    // La pista de selección llega junto a cada decisión (al repetirla no se reenvía).
    if (!m.retry) this.selectHint = null;
    this.sound = null;
    for (const ev of m.events) this.onEvent(ev, m.view);
    // Un solo sonido por actualización (el más importante). En el modo de dos jugadores en el
    // mismo móvil, solo suena la pantalla visible.
    const mine = !!m.prompt && !prevPrompt;
    if (this.visible) {
      const done = this.animatedNow && (this.sound === 'activate' || this.sound === 'attack' || this.sound === 'damage' || this.sound === 'turn');
      if (this.sound && !done) play(this.sound);
      else if (mine && !this.opts.hotseat) play('decide');
    }
    if (m.retry) this.toast('That action isn\'t possible right now: choose another.');
    // Nueva decisión: se reinicia la selección.
    if (m.prompt && (m.prompt !== prevPrompt || m.retry)) {
      this.picks = [];
      this.listMode = false;
      this.places = [];
      this.counters = [];
      this.modalHidden = false;
      this.announceQuery = '';
      if (m.prompt.type === OcgMessageType.SELECT_COUNTER) this.counters = m.prompt.cards.map(() => 0);
      if (this.sheet?.kind === 'detail' || this.sheet?.kind === 'pile') this.sheet = null;
    }
    this.autoRespond();
  }

  /** Decisiones sin elección real (o que el jugador pidió automatizar) se responden solas. */
  private autoRespond(): void {
    const u = this.u;
    const p = u?.prompt;
    if (!u || !p || this.sent) return;
    const cfg = settings();
    if (p.type === OcgMessageType.SELECT_CHAIN && !p.forced) {
      // Sin nada que activar: pasar (como EDOPro).
      if (p.selects.length === 0) return this.respond({ type: OcgResponseType.SELECT_CHAIN, index: null });
      // Modo "smart": no preguntar en simples cambios de fase, salvo los momentos clave.
      if (cfg.chains === 'smart' && p.spe_count === 0 && !u.retry && this.isQuietTiming(u)) {
        return this.respond({ type: OcgResponseType.SELECT_CHAIN, index: null });
      }
    }
    if (p.type === OcgMessageType.SELECT_PLACE && cfg.autoZone && p.count === 1 && !u.retry) {
      const me = u.view.you;
      const free = freePlaces(p.player, p.field_mask);
      // Solo si todas las zonas posibles son propias (si el efecto deja elegir del rival, se pregunta).
      const own = free.filter((z) => z.player === me);
      if (own.length && own.length === free.length) {
        return this.respond({ type: OcgResponseType.SELECT_PLACE, places: [own[0]] } as OcgResponse);
      }
    }
  }

  /**
   * ¿Es solo un cambio de fase sin nada a lo que responder? (cadena vacía y sin invocaciones,
   * activaciones, ataques ni movimientos). En la batalla y la fase final del rival sí se pregunta.
   */
  private isQuietTiming(u: Update): boolean {
    const v = u.view;
    if (v.chain.length) return false;
    if (v.turnPlayer !== v.you && (phaseKey(v.phase) === 8 || v.phase === 512)) return false;
    if (!u.events.length) return false;
    const quiet = new Set<number>([
      OcgMessageType.NEW_PHASE,
      OcgMessageType.NEW_TURN,
      OcgMessageType.HINT,
      OcgMessageType.PLAYER_HINT,
      OcgMessageType.CARD_HINT,
      OcgMessageType.DRAW,
      OcgMessageType.SHUFFLE_HAND,
      OcgMessageType.SHUFFLE_DECK,
    ]);
    return u.events.every((e) => quiet.has(e.type));
  }

  private respond(r: OcgResponse): void {
    if (!this.u || this.sent) return;
    this.sent = true;
    this.sheet = null;
    this.link.send({ t: 'respond', seq: this.u.seq, response: r });
    this.render();
    this.opts.onChange?.();
  }

  surrender(): void {
    this.link.send({ t: 'surrender' });
  }

  // ---------- eventos → registro y efectos ----------

  private nameOf(player: number): string {
    const me = this.u?.view.you ?? 0;
    return player === me ? this.opts.names[0] : this.opts.names[1];
  }

  private log(line: string): void {
    this.logLines.push(line);
    if (this.logLines.length > 300) this.logLines.shift();
    this.ticker = line;
  }

  private toast(text: string): void {
    this.ticker = text;
  }

  private sfx(s: Sfx): void {
    if (!this.sound || SFX_ORDER.indexOf(s) < SFX_ORDER.indexOf(this.sound)) this.sound = s;
  }

  private flash(controller: number, location: number, sequence: number): void {
    this.flashes.add(key(controller, location, sequence));
  }

  private onEvent(ev: OcgMessage, v: DuelView): void {
    const T = OcgMessageType;
    switch (ev.type) {
      case T.HINT:
        if (ev.hint_type === 3) this.selectHint = ev.hint;
        else if (ev.hint_type === 4) this.log(`${this.nameOf(1 - v.you)} chose: ${descText(ev.hint)}`);
        else if (ev.hint_type === 2) this.toast(descText(ev.hint));
        else if (ev.hint_type === 8) this.log(`${sys(212)} ${cardName(Number(ev.hint))}`);
        else if (ev.hint_type === 9) this.log(`${sys(215)} ${ev.hint}`);
        else if (ev.hint_type === 6) this.log(`${sys(213)} ${raceName(ev.hint)}`);
        else if (ev.hint_type === 7) this.log(`${sys(214)} ${attributeName(Number(ev.hint))}`);
        break;
      case T.NEW_TURN:
        this.log(`── Turn ${v.turn} · ${this.nameOf(ev.player & 1)} ──`);
        if (settings().anim === 'off' || !this.visible) this.banner = `TURN ${v.turn}`;
        if ((ev.player & 1) === v.you && settings().anim === 'off') this.sfx('turn');
        break;
      case T.NEW_PHASE: {
        const ph = PHASES.find(([id]) => id === phaseKey(ev.phase));
        if (ph && ev.phase !== 16 && ev.phase !== 32 && ev.phase !== 64 && ev.phase !== 128) this.ticker = ph[2];
        break;
      }
      case T.DRAW:
        this.log(`${this.nameOf(ev.player)} draws ${ev.drawn.length === 1 ? '1 card' : `${ev.drawn.length} cards`}.`);
        this.sfx('draw');
        break;
      case T.SUMMONING:
        this.log(`${this.nameOf(ev.controller)} Normal Summons ${cardName(ev.code)}.`);
        this.sfx('summon');
        this.flash(ev.controller, ev.location, ev.sequence);
        break;
      case T.SPSUMMONING:
        this.log(`${this.nameOf(ev.controller)} Special Summons ${cardName(ev.code)}.`);
        this.sfx('summon');
        this.flash(ev.controller, ev.location, ev.sequence);
        break;
      case T.FLIPSUMMONING:
        this.log(`${this.nameOf(ev.controller)} Flip Summons ${cardName(ev.code)}.`);
        this.sfx('summon');
        this.flash(ev.controller, ev.location, ev.sequence);
        break;
      case T.SET:
        this.log(`${this.nameOf(ev.controller)} Sets ${ev.code ? cardName(ev.code) : 'a card'}.`);
        this.sfx('set');
        break;
      case T.POS_CHANGE:
        if (ev.code) this.log(`${cardName(ev.code)} changes to ${POSITION_NAME[ev.position]?.toLowerCase() ?? 'another position'}.`);
        this.flash(ev.controller, ev.location, ev.sequence);
        break;
      case T.CHAINING:
        this.log(`${this.nameOf(ev.controller)} activates ${cardName(ev.code)}${ev.chain_size > 1 ? ` (Chain Link ${ev.chain_size})` : ''}.`);
        this.sfx('activate');
        this.flash(ev.controller, ev.location, ev.sequence);
        break;
      case T.CHAIN_NEGATED:
      case T.CHAIN_DISABLED:
        this.log(`Chain Link ${ev.chain_size} is negated.`);
        break;
      case T.ATTACK: {
        const a = this.codeAt(v, ev.card.controller, ev.card.location, ev.card.sequence);
        if (ev.target) {
          const t = this.codeAt(v, ev.target.controller, ev.target.location, ev.target.sequence);
          this.log(`${cardName(a)} attacks ${t ? cardName(t) : 'a face-down monster'}.`);
          this.flash(ev.target.controller, ev.target.location, ev.target.sequence);
        } else this.log(`${cardName(a)} attacks directly.`);
        this.flash(ev.card.controller, ev.card.location, ev.card.sequence);
        this.sfx('attack');
        break;
      }
      case T.ATTACK_DISABLED:
        this.log(sys(1621));
        break;
      case T.DAMAGE:
        this.log(`${this.nameOf(ev.player)} takes ${ev.amount} damage.`);
        this.sfx('damage');
        this.lpFx.push({ player: ev.player, text: `-${ev.amount}`, cls: 'dmg' });
        break;
      case T.PAY_LPCOST:
        this.log(`${this.nameOf(ev.player)} pays ${ev.amount} LP.`);
        this.sfx('damage');
        this.lpFx.push({ player: ev.player, text: `-${ev.amount}`, cls: 'dmg' });
        break;
      case T.RECOVER:
        this.log(`${this.nameOf(ev.player)} gains ${ev.amount} LP.`);
        this.sfx('heal');
        this.lpFx.push({ player: ev.player, text: `+${ev.amount}`, cls: 'heal' });
        break;
      case T.MOVE: {
        if (!ev.card) break;
        const to = ev.to.location;
        const from = ev.from.location;
        if (from === to) break;
        const n = cardName(ev.card);
        if (to === 16) this.log(`${n} is sent to the GY.`);
        else if (to === 32) this.log(`${n} is banished.`);
        else if (to === 2 && from !== 1) this.log(`${n} returns to ${this.nameOf(ev.to.controller)}'s hand.`);
        else if (to === 2 && from === 1) this.log(`${this.nameOf(ev.to.controller)} adds ${n} to their hand.`);
        else if (to === 1 || to === 64) this.log(`${n} returns to the ${LOCATION_NAME[to]}.`);
        if (to === 4 || to === 8) this.flash(ev.to.controller, to, ev.to.sequence);
        break;
      }
      case T.EQUIP: {
        const c = this.codeAt(v, ev.card.controller, ev.card.location, ev.card.sequence);
        const t = this.codeAt(v, ev.target.controller, ev.target.location, ev.target.sequence);
        if (c && t) this.log(`${cardName(c)} is equipped to ${cardName(t)}.`);
        break;
      }
      case T.ADD_COUNTER:
        this.log(`${ev.count === 1 ? '1 counter is placed' : `${ev.count} counters are placed`} (${counterName(ev.counter_type)}).`);
        break;
      case T.REMOVE_COUNTER:
        this.log(`${ev.count === 1 ? '1 counter is removed' : `${ev.count} counters are removed`} (${counterName(ev.counter_type)}).`);
        break;
      case T.TOSS_COIN:
        this.log(`${sys(1623)} ${ev.results.map((r) => (r ? 'heads' : 'tails')).join(', ')}`);
        break;
      case T.TOSS_DICE:
        this.log(`${sys(1624)} ${ev.results.join(', ')}`);
        break;
      case T.HAND_RES:
        this.log(`Rock-paper-scissors: ${ev.results.map((r) => RPS[r] ?? '?').join(' vs ')}`);
        break;
      case T.CONFIRM_CARDS:
      case T.CONFIRM_DECKTOP: {
        const codes = ev.cards.map((c) => c.code).filter(Boolean);
        if (codes.length) {
          this.reveal.push(...codes);
          this.log(`Revealed: ${codes.map(cardName).join(', ')}.`);
        }
        break;
      }
      case T.SHUFFLE_HAND:
        if (ev.player !== v.you) this.log(`${this.nameOf(ev.player)} shuffles their hand.`);
        break;
      case T.SHUFFLE_DECK:
        this.log(`${this.nameOf(ev.player)} shuffles their Deck.`);
        break;
      case T.CARD_SELECTED:
      case T.BECOME_TARGET:
        for (const c of ev.cards) this.flash(c.controller, c.location, c.sequence);
        break;
      case T.MISSED_EFFECT:
        this.log(fmt(sys(1622), cardName(ev.code)));
        break;
    }
  }

  private codeAt(v: DuelView, controller: number, location: number, sequence: number): number {
    return this.cardAt(v, key(controller, location, sequence))?.code ?? 0;
  }

  private cardAt(v: DuelView, k: string): ViewCard | null {
    const [c, l, s] = k.split(':').map(Number);
    const p = v.players[c];
    if (!p) return null;
    switch (l) {
      case 2:
        return p.hand[s] ?? null;
      case 4:
        return p.monsters[s] ?? null;
      case 8:
        return p.spells[s] ?? null;
      case 256:
        return p.spells[5] ?? null;
      case 16:
        return p.grave[s] ?? null;
      case 32:
        return p.banished[s] ?? null;
      case 64:
        return p.extra[s] ?? null;
    }
    return null;
  }

  // ---------- interacción ----------

  private h(fn: () => void): string {
    const id = `h${++this.hid}`;
    this.handlers.set(id, fn);
    return `data-h="${id}"`;
  }

  private onClick(e: Event): void {
    const t = e.target as HTMLElement;
    const hEl = t.closest<HTMLElement>('[data-h]');
    if (hEl) {
      e.preventDefault();
      const fn = this.handlers.get(hEl.dataset.h!);
      if (fn) {
        fn();
        this.render();
      }
      return;
    }
    const z = t.closest<HTMLElement>('[data-z]');
    if (z) {
      this.onZone(z.dataset.z!);
      this.render();
      return;
    }
    const pile = t.closest<HTMLElement>('[data-pile]');
    if (pile) {
      this.sheet = { kind: 'pile', key: pile.dataset.pile! };
      this.render();
    }
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.id !== 'announce-q') return;
    this.announceQuery = t.value;
    const box = this.el.querySelector('#announce-results');
    if (box) box.innerHTML = this.announceResults();
  }

  private onZone(k: string): void {
    const targets = this.boardTargets();
    if (targets && this.deciding) {
      const i = targets.get(k);
      if (i !== undefined) this.pickTarget(i);
      return;
    }
    const pl = this.placeable.get(k);
    if (pl && this.deciding) {
      const i = this.places.findIndex((p) => key(p.player, p.location, p.sequence) === k);
      if (i >= 0) this.places.splice(i, 1);
      else this.places.push(pl);
      const p = this.u!.prompt!;
      if ((p.type === OcgMessageType.SELECT_PLACE || p.type === OcgMessageType.SELECT_DISFIELD) && this.places.length >= p.count) {
        this.respond({ type: p.type === OcgMessageType.SELECT_PLACE ? OcgResponseType.SELECT_PLACE : OcgResponseType.SELECT_DISFIELD, places: this.places } as OcgResponse);
      }
      return;
    }
    this.sheet = { kind: 'detail', key: k };
  }

  /** Acciones disponibles en cada carta para la decisión actual (fase principal / batalla). */
  private computeActions(): void {
    this.zoneActions.clear();
    this.placeable.clear();
    const p = this.u?.prompt;
    if (!p || this.sent || this.ended) return;
    const add = (c: { controller: number; location: number; sequence: number }, label: string, r: OcgResponse) => {
      const k = key(c.controller, c.location === 256 ? 8 : c.location, c.location === 256 ? 5 : c.sequence);
      const list = this.zoneActions.get(k) ?? [];
      list.push({ label, run: () => this.respond(r) });
      this.zoneActions.set(k, list);
    };
    const R = OcgResponseType;
    if (p.type === OcgMessageType.SELECT_IDLECMD) {
      p.summons.forEach((c, i) => add(c, 'Normal Summon', { type: R.SELECT_IDLECMD, action: 0, index: i }));
      p.special_summons.forEach((c, i) => add(c, 'Special Summon', { type: R.SELECT_IDLECMD, action: 1, index: i }));
      p.pos_changes.forEach((c, i) => add(c, 'Change position', { type: R.SELECT_IDLECMD, action: 2, index: i }));
      p.monster_sets.forEach((c, i) => add(c, 'Set', { type: R.SELECT_IDLECMD, action: 3, index: i }));
      p.spell_sets.forEach((c, i) => add(c, 'Set', { type: R.SELECT_IDLECMD, action: 4, index: i }));
      p.activates.forEach((c, i) => add(c, this.activateLabel(c, p.activates), { type: R.SELECT_IDLECMD, action: 5, index: i }));
    } else if (p.type === OcgMessageType.SELECT_BATTLECMD) {
      p.attacks.forEach((c, i) => add(c, c.can_direct ? 'Attack (direct attack possible)' : 'Attack', { type: R.SELECT_BATTLECMD, action: 1, index: i }));
      p.chains.forEach((c, i) => add(c, this.activateLabel(c, p.chains), { type: R.SELECT_BATTLECMD, action: 0, index: i }));
    } else if (p.type === OcgMessageType.SELECT_PLACE || p.type === OcgMessageType.SELECT_DISFIELD) {
      for (const pl of freePlaces(p.player, p.field_mask)) this.placeable.set(key(pl.player, pl.location, pl.sequence), pl);
    }
  }

  private activateLabel(c: { code: number; description: bigint }, all: { code: number; controller: number; location: number; sequence: number }[]): string {
    const same = all.filter((x) => x.code === c.code).length;
    if (same > 1 || (c.description && Number(c.description >> 20n) !== 0)) {
      const d = descText(c.description);
      if (d && !d.startsWith('Effect of')) return `Activate: ${d}`;
    }
    return 'Activate';
  }

  // ---------- render ----------

  render(): void {
    this.handlers.clear();
    this.hid = 0;
    if (!this.u) {
      this.el.innerHTML = `<div class="loading">Setting up the duel…</div>`;
      return;
    }
    this.computeActions();
    const html = [this.boardHtml(), this.promptHtml(), this.sheetHtml(), this.endHtml()].join('');
    this.el.innerHTML = html;
    // Efectos de un solo uso.
    this.flashes.clear();
    this.lpFx = [];
    this.banner = '';
    const q = this.el.querySelector<HTMLInputElement>('#announce-q');
    if (q && document.activeElement !== q && this.visible) q.focus();
  }

  private boardHtml(): string {
    const v = this.u!.view;
    const me = v.you;
    const op = (1 - me) as 0 | 1;
    const cols = [0, 1, 2, 3, 4];
    const rev = [4, 3, 2, 1, 0];
    // Online, el rival se ve en espejo (como al otro lado de la mesa). En el mismo móvil la pantalla
    // cambia de jugador a menudo: sin espejo, cada carta queda en la misma columna en las dos vistas
    // y no parece que se mueva al girar.
    const oppRows = this.opts.hotseat
      ? `<div class="row">${this.pileCell(op, 64)}${cols.map((i) => this.zoneCell(op, 8, i)).join('')}${this.pileCell(op, 1)}</div>
        <div class="row">${this.zoneCell(op, 8, 5)}${cols.map((i) => this.zoneCell(op, 4, i)).join('')}${this.pileCell(op, 16)}</div>`
      : `<div class="row">${this.pileCell(op, 1)}${rev.map((i) => this.zoneCell(op, 8, i)).join('')}${this.pileCell(op, 64)}</div>
        <div class="row">${this.pileCell(op, 16)}${rev.map((i) => this.zoneCell(op, 4, i)).join('')}${this.zoneCell(op, 8, 5)}</div>`;
    const phase = phaseKey(v.phase);
    const phases = PHASES.map(([id, short]) => `<span class="${id === phase ? 'on' : ''}">${short}</span>`).join('');
    const turnOwner = v.turnPlayer === me ? 'mine' : 'theirs';
    const chain = v.chain.length ? `<button class="chainbtn" ${this.h(() => (this.sheet = { kind: 'chain' }))}>CHAIN ${v.chain.length}</button>` : '';
    const reveal = this.reveal.length
      ? `<div class="reveal">${this.reveal.map((c, i) => miniCard(c, { cls: 'xs', data: `data-rv="${i}"` })).join('')}</div>`
      : '';
    return `
      ${this.playerBar(op, 'opp')}
      ${this.netText() ? `<div class="netbanner">${esc(this.netText())}</div>` : ''}
      <div class="field ${turnOwner}">
        ${oppRows}
        <div class="mid">
          <div class="phases">${phases}</div>
          ${chain}
          <button class="ticker" ${this.h(() => (this.sheet = { kind: 'log' }))}>${esc(this.ticker || 'Tap a card to see it')}</button>
        </div>
        <div class="row">${this.zoneCell(me, 8, 5)}${cols.map((i) => this.zoneCell(me, 4, i)).join('')}${this.pileCell(me, 16)}</div>
        <div class="row">${this.pileCell(me, 64)}${cols.map((i) => this.zoneCell(me, 8, i)).join('')}${this.pileCell(me, 1)}</div>
        ${this.banner ? `<div class="banner">${this.banner}</div>` : ''}
        ${reveal}
      </div>
      ${this.playerBar(me, 'me')}
      <div class="hand">${v.players[me].hand
        .map((c, i) => {
          const k = key(me, 2, i);
          const cls = [this.zoneActions.has(k) ? 'hl' : '', this.flashes.has(k) ? 'flash' : '', this.targetCls(k)].join(' ');
          return miniCard(c.code, { cls, data: `data-z="${k}"`, back: this.backOf(me) });
        })
        .join('')}</div>
      ${this.barHtml()}`;
  }

  private playerBar(p: 0 | 1, side: 'me' | 'opp'): string {
    const v = this.u!.view;
    const pl = v.players[p];
    const fx = this.lpFx.filter((f) => f.player === p).map((f) => `<span class="lpfx ${f.cls}">${f.text}</span>`).join('');
    const lpPct = Math.max(0, Math.min(100, (pl.lp / 8000) * 100));
    const oppHand = side === 'opp' ? `<span class="chip" title="Hand">✋${pl.hand.length}</span>` : '';
    const active = v.turnPlayer === p ? 'active' : '';
    const menu = side === 'me' ? `<button class="menubtn" ${this.h(() => (this.sheet = { kind: 'menu' }))} aria-label="Menu">☰</button>` : '';
    return `<div class="pbar ${side} ${active}">
      <span class="pname">${esc(this.nameOf(p))}</span>
      <span class="lp"><span class="lpbar"><i style="width:${lpPct}%"></i></span><b>${pl.lp}</b>${fx}</span>
      ${oppHand}
      <button class="chip" data-pile="${p}:32">BAN ${pl.banished.length}</button>
      ${menu}
    </div>`;
  }

  private zoneCell(p: number, loc: 4 | 8, seq: number): string {
    const v = this.u!.view;
    const pl = v.players[p];
    const c = loc === 4 ? pl.monsters[seq] : pl.spells[seq];
    const k = key(p, loc, seq);
    const cls = ['zone', loc === 4 ? 'zm' : seq === 5 ? 'zf' : 'zs'];
    if (this.zoneActions.has(k)) cls.push('hl');
    cls.push(this.targetCls(k));
    if (this.placeable.has(k)) cls.push('pl');
    if (this.places.some((x) => key(x.player, x.location, x.sequence) === k)) cls.push('picked');
    if (this.flashes.has(k)) cls.push('flash');
    if (v.chain.some((ch) => ch.controller === p && (ch.location === loc || (ch.location === 256 && seq === 5)) && ch.sequence === (ch.location === 256 ? 0 : seq))) cls.push('chained');
    const inner = c ? miniCard(c.code, { position: c.position, attack: c.attack, defense: c.defense, monster: loc === 4, back: this.backOf(p) }) : seq === 5 ? '<span class="zl">FIELD</span>' : '';
    const ctr = c?.counters ? `<span class="ctr">${Object.values(c.counters).reduce((a, b) => a + b, 0)}</span>` : '';
    return `<div class="${cls.join(' ')}" data-z="${k}">${inner}${ctr}</div>`;
  }

  private pileCell(p: number, loc: 1 | 16 | 64): string {
    const pl = this.u!.view.players[p];
    const label = loc === 1 ? 'DECK' : loc === 16 ? 'GY' : 'EXTRA';
    const count = loc === 1 ? pl.deckCount : loc === 16 ? pl.grave.length : pl.extraCount;
    let top = '';
    if (loc === 1 && count) top = miniCard(0, { back: this.backOf(p) });
    if (loc === 64 && count) top = miniCard(0, { back: this.backOf(p) });
    if (loc === 16 && count) top = miniCard(pl.grave[pl.grave.length - 1].code);
    const k = `${p}:${loc}`;
    const hl = [...this.zoneActions.keys()].some((z) => z.startsWith(`${p}:${loc}:`)) ? 'hl' : '';
    return `<div class="zone pile ${hl}" data-pile="${k}">${top}<span class="pc">${label}<b>${count}</b></span></div>`;
  }

  private button(label: string, fn: () => void, cls = ''): string {
    return `<button class="btn ${cls}" ${this.h(fn)}>${esc(label)}</button>`;
  }

  /** Barra inferior: qué toca hacer y los botones de fase. */
  private barHtml(): string {
    const u = this.u!;
    const p = u.prompt;
    const R = OcgResponseType;
    if (this.ended) return `<div class="bar"><span class="btxt">Duel over.</span><span class="bbtns">${this.button('See result', () => (this.endHidden = false), 'go')}</span></div>`;
    if (!p || this.sent) {
      const who = u.waitingFor === null ? '' : this.nameOf(u.waitingFor);
      return `<div class="bar wait"><span class="btxt">${who ? `Waiting for ${esc(who)}…` : '…'}</span></div>`;
    }
    const btns: string[] = [];
    let text = '';
    if (this.boardTargets()) return this.targetBar();
    switch (p.type) {
      case OcgMessageType.SELECT_IDLECMD:
        text = this.u!.view.phase === 256 ? 'Main Phase 2: tap a card.' : 'Main Phase: tap a card.';
        if (p.to_bp) btns.push(this.button('Battle', () => this.respond({ type: R.SELECT_IDLECMD, action: 6, index: null }), 'go'));
        if (p.to_ep) btns.push(this.button('End turn', () => this.respond({ type: R.SELECT_IDLECMD, action: 7, index: null })));
        break;
      case OcgMessageType.SELECT_BATTLECMD:
        text = p.attacks.length ? 'Battle: tap a monster to attack.' : 'Battle Phase.';
        if (p.to_m2) btns.push(this.button('Main Phase 2', () => this.respond({ type: R.SELECT_BATTLECMD, action: 2, index: null }), 'go'));
        if (p.to_ep) btns.push(this.button('End turn', () => this.respond({ type: R.SELECT_BATTLECMD, action: 3, index: null })));
        break;
      case OcgMessageType.SELECT_PLACE:
      case OcgMessageType.SELECT_DISFIELD: {
        text = this.selectHint ? descText(this.selectHint) : p.type === OcgMessageType.SELECT_PLACE ? 'Choose a zone.' : sys(570);
        text = hintText(text);
        if (p.count > 1) text += ` (${this.places.length}/${p.count})`;
        const free = [...this.placeable.values()];
        btns.push(
          this.button('Auto', () =>
            this.respond({ type: p.type === OcgMessageType.SELECT_PLACE ? R.SELECT_PLACE : R.SELECT_DISFIELD, places: free.slice(0, p.count) } as OcgResponse),
          ),
        );
        break;
      }
      default:
        text = this.modalHidden ? 'Looking at the field.' : 'Your decision…';
        if (this.modalHidden) btns.push(this.button('Back to decision', () => (this.modalHidden = false), 'go'));
    }
    return `<div class="bar"><span class="btxt">${esc(text)}</span><span class="bbtns">${btns.join('')}</span></div>`;
  }

  // ---------- decisiones con ventana ----------

  private promptHtml(): string {
    const p = this.u!.prompt;
    if (!p || this.sent || this.ended || this.modalHidden || this.busy) return '';
    if (this.boardTargets()) return '';
    const body = this.promptBody(p);
    if (!body) return '';
    return `<div class="modal"><div class="mbox">${body}<div class="mfoot">${this.button('View field', () => (this.modalHidden = true), 'ghost')}</div></div></div>`;
  }

  private title(fallback: string): string {
    const t = this.selectHint ? descText(this.selectHint) : fallback;
    return `<h2>${esc(hintText(t))}</h2>`;
  }

  private locLabel(c: { controller: number; location: number; sequence: number; position?: number }): string {
    const me = this.u!.view.you;
    const who = c.controller === me ? 'Yours' : 'Opponent';
    const where = c.location === 4 ? `M${c.sequence + 1}` : c.location === 8 ? (c.sequence === 5 ? 'Field' : `S/T${c.sequence + 1}`) : (LOCATION_NAME[c.location] ?? '');
    return `${who} · ${where}`;
  }

  /**
   * Color del dorso de las cartas de un jugador: en el mismo móvil, Player 1 azul y Player 2 rojo;
   * online, las tuyas azules y las del rival rojas.
   */
  private backOf(p: number): 'blue' | 'red' {
    const me = this.u?.view.you ?? 0;
    if (!this.opts.hotseat) return p === me ? 'blue' : 'red';
    // El equipo 0 del motor es quien empieza; el color va por asiento (Player 1 / Player 2).
    const seat = p === me ? (this.opts.seat ?? 0) : 1 - (this.opts.seat ?? 0);
    return seat === 0 ? 'blue' : 'red';
  }

  /**
   * Selección de cartas en el propio tablero: si TODAS las cartas elegibles están a la vista (campo de
   * los dos jugadores o tu mano), devuelve zona → índice de la opción. Si alguna está en el
   * cementerio, el mazo, desterrada o en la mano del rival, se usa la lista (null).
   */
  private boardTargets(): Map<string, number> | null {
    const u = this.u;
    const p = u?.prompt;
    if (!u || !p || this.sent || this.ended || this.listMode || !this.deciding) return null;
    const T = OcgMessageType;
    let list: { controller: number; location: number; sequence: number }[];
    if (p.type === T.SELECT_CARD || p.type === T.SELECT_TRIBUTE) list = p.selects;
    else if (p.type === T.SELECT_UNSELECT_CARD) list = [...p.select_cards, ...p.unselect_cards];
    else return null;
    const me = u.view.you;
    const out = new Map<string, number>();
    for (const [i, c] of list.entries()) {
      const loc = c.location;
      if (!(loc === 4 || loc === 8 || (loc === 2 && c.controller === me))) return null;
      out.set(key(c.controller, loc, c.sequence), i);
    }
    return out.size ? out : null;
  }

  /** Clase de una zona/carta durante la selección en el tablero: elegible o ya elegida. */
  private targetCls(k: string): string {
    const t = this.boardTargets();
    const i = t?.get(k);
    if (i === undefined) return '';
    const p = this.u!.prompt!;
    const chosen = p.type === OcgMessageType.SELECT_UNSELECT_CARD ? i >= p.select_cards.length : this.picks.includes(i);
    return chosen ? 'tg picked' : 'tg';
  }

  private pickTarget(i: number): void {
    const p = this.u!.prompt!;
    const T = OcgMessageType;
    if (p.type === T.SELECT_UNSELECT_CARD) return void this.respond({ type: OcgResponseType.SELECT_UNSELECT_CARD, index: i });
    if (p.type !== T.SELECT_CARD && p.type !== T.SELECT_TRIBUTE) return;
    this.togglePick(i, p.max);
    // Una sola carta exacta (objetivo de ataque, la mayoría de efectos): se elige al tocarla.
    if (p.type === T.SELECT_CARD && p.min === 1 && p.max === 1 && this.picks.length === 1) {
      this.respond({ type: OcgResponseType.SELECT_CARD, indicies: [...this.picks] } as OcgResponse);
    }
  }

  /** Barra inferior mientras se elige en el tablero. */
  private targetBar(): string {
    const p = this.u!.prompt!;
    const R = OcgResponseType;
    const T = OcgMessageType;
    const btns: string[] = [];
    const head = hintText(this.selectHint ? descText(this.selectHint) : p.type === T.SELECT_TRIBUTE ? sys(531) : sys(560));
    let text = head;
    if (p.type === T.SELECT_CARD || p.type === T.SELECT_TRIBUTE) {
      const tribute = p.type === T.SELECT_TRIBUTE;
      const weight = (i: number) => (tribute ? Math.max(1, (p as { selects: { release_param: number }[] }).selects[i].release_param & 0xff) : 1);
      const total = this.picks.reduce((a, i) => a + weight(i), 0);
      const ok = tribute ? total >= p.min && this.picks.length <= p.max : this.picks.length >= p.min && this.picks.length <= p.max;
      const range = p.min === p.max ? `${p.min}` : `${p.min}–${p.max}`;
      text = `${head} · tap ${range} highlighted card${p.max === 1 ? '' : 's'}`;
      if (!(p.type === T.SELECT_CARD && p.min === 1 && p.max === 1)) {
        btns.push(this.button(`OK (${this.picks.length})`, () => ok && this.respond({ type: tribute ? R.SELECT_TRIBUTE : R.SELECT_CARD, indicies: [...this.picks] } as OcgResponse), ok ? 'go' : 'off'));
      }
      if (p.can_cancel) btns.push(this.button('Cancel', () => this.respond({ type: tribute ? R.SELECT_TRIBUTE : R.SELECT_CARD, indicies: null } as OcgResponse)));
    } else if (p.type === T.SELECT_UNSELECT_CARD) {
      text = `${head} · tap the highlighted cards`;
      if (p.can_finish) btns.push(this.button('Finish', () => this.respond({ type: R.SELECT_UNSELECT_CARD, index: null }), 'go'));
      if (p.can_cancel) btns.push(this.button('Cancel', () => this.respond({ type: R.SELECT_UNSELECT_CARD, index: null })));
    }
    btns.push(this.button('List', () => (this.listMode = true)));
    return `<div class="bar target"><span class="btxt">${esc(text)}</span><span class="bbtns">${btns.join('')}</span></div>`;
  }

  /** Lista de cartas seleccionables (con su sitio). */
  private cardGrid(list: { code: number; controller: number; location: number; sequence: number; position?: number }[], isPicked: (i: number) => boolean, onTap: (i: number) => void, extra?: (i: number) => string): string {
    return `<div class="grid">${list
      .map((c, i) => {
        const onField = c.location === 4 || c.location === 8;
        const pos = onField ? (c.position ?? this.cardAt(this.u!.view, key(c.controller, c.location, c.sequence))?.position) : undefined;
        return `<button class="gi ${isPicked(i) ? 'picked' : ''}" ${this.h(() => onTap(i))}>${miniCard(c.code, { position: pos && (pos & 0xa) && c.code ? 8 : 1, back: this.backOf(c.controller) })}<span class="gl">${esc(c.code ? cardName(c.code) : 'Face-down')}</span><span class="gs">${esc(this.locLabel(c))}</span>${extra ? extra(i) : ''}</button>`;
      })
      .join('')}</div>`;
  }

  private togglePick(i: number, max: number): void {
    const at = this.picks.indexOf(i);
    if (at >= 0) this.picks.splice(at, 1);
    else if (max === 1) this.picks = [i];
    else if (this.picks.length < max) this.picks.push(i);
  }

  private promptBody(p: Prompt): string {
    const R = OcgResponseType;
    const T = OcgMessageType;
    const yesNo = (type: OcgResponseType.SELECT_EFFECTYN | OcgResponseType.SELECT_YESNO) =>
      `<div class="mbtns">${this.button('Yes', () => this.respond({ type, yes: true } as OcgResponse), 'go')}${this.button('No', () => this.respond({ type, yes: false } as OcgResponse))}</div>`;
    switch (p.type) {
      case T.SELECT_CHAIN: {
        const head = p.forced ? 'Choose the effect to activate' : 'Chain a card or effect?';
        const chainInfo = this.u!.view.chain.length ? `<p class="muted">Current chain: ${this.u!.view.chain.map((c) => esc(cardName(c.code))).join(' → ')}</p>` : '';
        const list = p.selects
          .map((c, i) => `<button class="opt" ${this.h(() => this.respond({ type: R.SELECT_CHAIN, index: i }))}>${miniCard(c.code, { cls: 'xs' })}<span><b>${esc(cardName(c.code))}</b><br><small>${esc(this.effectText(c.code, c.description))}</small></span></button>`)
          .join('');
        const no = p.forced ? '' : this.button('No encadenar', () => this.respond({ type: R.SELECT_CHAIN, index: null }));
        return `<h2>${esc(head)}</h2>${chainInfo}<div class="opts">${list}</div><div class="mbtns">${no}</div>`;
      }
      case T.SELECT_EFFECTYN: {
        const name = cardName(p.code);
        const loc = LOCATION_NAME[p.location] ?? '';
        const text = !p.description ? fmt(sys(200), name, loc) : p.description === 221n ? fmt(sys(221), name, loc) : fmt(descText(p.description), name);
        return `<div class="ask">${miniCard(p.code, { cls: 'sm' })}<p>${esc(text)}</p></div>${yesNo(R.SELECT_EFFECTYN)}`;
      }
      case T.SELECT_YESNO:
        return `<p class="q">${esc(fmt(descText(p.description), ''))}</p>${yesNo(R.SELECT_YESNO)}`;
      case T.SELECT_OPTION:
        return `${this.title(sys(555))}<div class="mbtns col">${p.options.map((o, i) => this.button(descText(o), () => this.respond({ type: R.SELECT_OPTION, index: i }))).join('')}</div>`;
      case T.SELECT_CARD:
      case T.SELECT_TRIBUTE: {
        const tribute = p.type === T.SELECT_TRIBUTE;
        const weight = (i: number) => (tribute ? Math.max(1, (p as { selects: { release_param: number }[] }).selects[i].release_param & 0xff) : 1);
        const total = this.picks.reduce((a, i) => a + weight(i), 0);
        const ok = tribute ? total >= p.min && this.picks.length <= p.max : this.picks.length >= p.min && this.picks.length <= p.max;
        const range = p.min === p.max ? `${p.min}` : `${p.min}–${p.max}`;
        const accept = this.button(`OK (${this.picks.length})`, () => ok && this.respond({ type: tribute ? R.SELECT_TRIBUTE : R.SELECT_CARD, indicies: [...this.picks] } as OcgResponse), ok ? 'go' : 'off');
        const cancel = p.can_cancel ? this.button('Cancel', () => this.respond({ type: tribute ? R.SELECT_TRIBUTE : R.SELECT_CARD, indicies: null } as OcgResponse)) : '';
        return `${this.title(tribute ? sys(531) : sys(560))}<p class="muted">Choose ${range}.</p>${this.cardGrid(p.selects, (i) => this.picks.includes(i), (i) => this.togglePick(i, p.max))}<div class="mbtns">${accept}${cancel}</div>`;
      }
      case T.SELECT_UNSELECT_CARD: {
        const all = [...p.select_cards, ...p.unselect_cards];
        const n = p.select_cards.length;
        const btns = [p.can_finish ? this.button('Finish', () => this.respond({ type: R.SELECT_UNSELECT_CARD, index: null }), 'go') : '', p.can_cancel ? this.button('Cancel', () => this.respond({ type: R.SELECT_UNSELECT_CARD, index: null })) : ''].join('');
        return `${this.title(sys(560))}<p class="muted">Choose ${p.min === p.max ? p.min : `${p.min}–${p.max}`}. Highlighted cards are already chosen (tap to remove them).</p>${this.cardGrid(all, (i) => i >= n, (i) => this.respond({ type: R.SELECT_UNSELECT_CARD, index: i }))}<div class="mbtns">${btns}</div>`;
      }
      case T.SELECT_SUM: {
        const must = p.selects_must;
        const vals = (a: number) => [a & 0xffff, (a >>> 16) & 0xffff].filter((x, k) => k === 0 || x);
        const sums = (idx: number[]) => {
          let s = new Set([0]);
          for (const c of [...must.map((m) => m.amount), ...idx.map((i) => p.selects[i].amount)]) {
            const next = new Set<number>();
            for (const x of s) for (const v of vals(c)) next.add(x + v);
            s = next;
          }
          return [...s];
        };
        const ss = sums(this.picks);
        const ok = p.select_max ? ss.some((s) => s >= p.amount) : ss.includes(p.amount);
        const mustHtml = must.length ? `<p class="muted">Required: ${must.map((c) => esc(cardName(c.code))).join(', ')}</p>` : '';
        const accept = this.button('OK', () => ok && this.respond({ type: R.SELECT_SUM, indicies: this.picks.map((i) => i + must.length) } as OcgResponse), ok ? 'go' : 'off');
        return `${this.title(sys(560))}<p class="muted">The total must be ${p.select_max ? 'at least ' : ''}${p.amount}.</p>${mustHtml}${this.cardGrid(
          p.selects,
          (i) => this.picks.includes(i),
          (i) => this.togglePick(i, 99),
          (i) => `<span class="gv">${vals(p.selects[i].amount).join('/')}</span>`,
        )}<div class="mbtns">${accept}</div>`;
      }
      case T.SELECT_POSITION:
        return `<div class="ask">${miniCard(p.code, { cls: 'sm' })}<p>${esc(sys(561))}</p></div><div class="mbtns col">${bitsOf(p.positions)
          .map((b) => this.button(POSITION_NAME[1 << b] ?? `${1 << b}`, () => this.respond({ type: R.SELECT_POSITION, position: (1 << b) as 1 })))
          .join('')}</div>`;
      case T.SORT_CARD:
      case T.SORT_CHAIN: {
        const done = this.picks.length === p.cards.length;
        return `${this.title(p.type === T.SORT_CHAIN ? sys(206) : sys(205))}<p class="muted">Tap the cards in order.</p>${this.cardGrid(
          p.cards,
          (i) => this.picks.includes(i),
          (i) => !this.picks.includes(i) && this.picks.push(i),
          (i) => (this.picks.includes(i) ? `<span class="gv">${this.picks.indexOf(i) + 1}</span>` : ''),
        )}<div class="mbtns">${this.button('OK', () => done && this.respond({ type: R.SORT_CARD, order: [...this.picks] }), done ? 'go' : 'off')}${this.button('Reset', () => (this.picks = []))}${this.button('Default', () => this.respond({ type: R.SORT_CARD, order: null }))}</div>`;
      }
      case T.SELECT_COUNTER: {
        const total = this.counters.reduce((a, b) => a + b, 0);
        const ok = total === p.count;
        const rows = p.cards
          .map(
            (c, i) =>
              `<div class="crow">${miniCard(c.code, { cls: 'xs' })}<span>${esc(cardName(c.code))}<br><small>${c.count} available</small></span>${this.button('−', () => (this.counters[i] = Math.max(0, this.counters[i] - 1)))}<b>${this.counters[i]}</b>${this.button('+', () => (this.counters[i] = Math.min(c.count, this.counters[i] + 1)))}</div>`,
          )
          .join('');
        return `<h2>Remove ${p.count} ${esc(counterName(p.counter_type))}</h2>${rows}<div class="mbtns">${this.button(`OK (${total}/${p.count})`, () => ok && this.respond({ type: R.SELECT_COUNTER, counters: [...this.counters] }), ok ? 'go' : 'off')}</div>`;
      }
      case T.ROCK_PAPER_SCISSORS:
        return `<h2>Rock, paper, scissors</h2><div class="mbtns">${[2, 3, 1].map((v) => this.button(RPS[v], () => this.respond({ type: R.ROCK_PAPER_SCISSORS, value: v as 1 | 2 | 3 }), 'go')).join('')}</div>`;
      case T.ANNOUNCE_RACE: {
        const avail = bitsOf(p.available);
        const ok = this.picks.length === p.count;
        return `${this.title(sys(563))}<div class="chips">${avail
          .map((b) => `<button class="chipbtn ${this.picks.includes(b) ? 'picked' : ''}" ${this.h(() => this.togglePick(b, p.count))}>${esc(raceName(1n << BigInt(b)))}</button>`)
          .join('')}</div><div class="mbtns">${this.button('OK', () => ok && this.respond({ type: R.ANNOUNCE_RACE, races: this.picks.map((b) => 1n << BigInt(b)) } as OcgResponse), ok ? 'go' : 'off')}</div>`;
      }
      case T.ANNOUNCE_ATTRIB: {
        const avail = bitsOf(p.available);
        const ok = this.picks.length === p.count;
        return `${this.title(sys(562))}<div class="chips">${avail
          .map((b) => `<button class="chipbtn ${this.picks.includes(b) ? 'picked' : ''}" ${this.h(() => this.togglePick(b, p.count))}>${esc(attributeName(1 << b))}</button>`)
          .join('')}</div><div class="mbtns">${this.button('OK', () => ok && this.respond({ type: R.ANNOUNCE_ATTRIB, attributes: this.picks.map((b) => 1 << b) } as OcgResponse), ok ? 'go' : 'off')}</div>`;
      }
      case T.ANNOUNCE_CARD:
        return `${this.title(sys(564))}<input id="announce-q" class="search" placeholder="Type the name…" value="${esc(this.announceQuery)}" autocomplete="off"><div id="announce-results" class="results">${this.announceResults()}</div>`;
      case T.ANNOUNCE_NUMBER:
        return `${this.title(sys(565))}<div class="mbtns wrap">${p.options.map((o, i) => this.button(String(o), () => this.respond({ type: R.ANNOUNCE_NUMBER, value: i }))).join('')}</div>`;
    }
    return '';
  }

  private announceResults(): string {
    const q = this.announceQuery.trim().toLowerCase();
    if (q.length < 2) return '<p class="muted">Type at least 2 letters.</p>';
    const hits = allPoolCodes()
      .filter((c) => cardName(c).toLowerCase().includes(q))
      .slice(0, 40);
    if (!hits.length) return '<p class="muted">No results.</p>';
    return hits.map((c) => `<button class="opt" ${this.h(() => this.respond({ type: OcgResponseType.ANNOUNCE_CARD, card: c }))}>${miniCard(c, { cls: 'xs' })}<span>${esc(cardName(c))}</span></button>`).join('');
  }

  private effectText(code: number, description: bigint): string {
    if (!description) return 'Activate';
    const d = descText(description);
    return d.startsWith('Effect of') ? `Effect of ${cardName(code)}` : d;
  }

  // ---------- paneles ----------

  private sheetHtml(): string {
    const s = this.sheet;
    if (!s) return '';
    const v = this.u!.view;
    const close = this.button('Close', () => (this.sheet = null), 'ghost');
    let body = '';
    switch (s.kind) {
      case 'detail': {
        const c = this.cardAt(v, s.key);
        const code = c?.code ?? 0;
        if (!c) {
          this.sheet = null;
          return '';
        }
        const acts = (this.zoneActions.get(s.key) ?? []).map((a) => this.button(a.label, a.run, 'go')).join('');
        body = `<div class="detail">${bigCard(code, s.key.split(':')[1] === '4' ? c.position : undefined)}<div class="info">${cardInfoHtml(code, { attack: c.attack, defense: c.defense, level: c.level })}</div></div>${acts ? `<div class="mbtns col">${acts}</div>` : ''}`;
        break;
      }
      case 'pile': {
        const [pp, loc] = s.key.split(':').map(Number);
        const pl = v.players[pp];
        const list = loc === 16 ? pl.grave : loc === 32 ? pl.banished : loc === 64 ? pl.extra : [];
        const title = `${LOCATION_NAME[loc]} · ${this.nameOf(pp)}`;
        const count = loc === 1 ? pl.deckCount : loc === 64 ? pl.extraCount : list.length;
        const items = list
          .map((c, i) => ({ c, i }))
          .reverse()
          .map(({ c, i }) => {
            const k = key(pp, loc, i);
            return miniCard(c.code, { cls: this.zoneActions.has(k) ? 'hl' : '', data: `data-z="${k}"`, position: (c.position & 0xa) && c.code ? 8 : 1, back: this.backOf(pp) });
          })
          .join('');
        const note = loc === 1 ? '<p class="muted">The Deck is face-down.</p>' : loc === 64 && pp !== v.you ? `<p class="muted">You can't see your opponent's Extra Deck.</p>` : !list.length ? '<p class="muted">Empty.</p>' : '';
        body = `<h2>${esc(title)} (${count})</h2>${note}<div class="pilegrid">${items}</div>`;
        break;
      }
      case 'chain':
        body = `<h2>Chain</h2><div class="opts">${v.chain
          .map((c, i) => `<div class="opt">${miniCard(c.code, { cls: 'xs' })}<span><b>${i + 1}. ${esc(cardName(c.code))}</b><br><small>${esc(this.nameOf(c.controller))}</small></span></div>`)
          .join('')}</div>`;
        break;
      case 'log':
        body = `<h2>Duel log</h2><div class="log">${this.logLines
          .slice()
          .reverse()
          .map((l) => `<div>${esc(l)}</div>`)
          .join('')}</div>`;
        break;
      case 'menu':
        const cfg = settings();
        body = `<h2>Menu</h2><div class="mbtns col">${this.button('Duel log', () => (this.sheet = { kind: 'log' }))}${this.button(
          `Sound: ${cfg.sound ? 'on' : 'off'}`,
          () => updateSettings({ sound: !cfg.sound }),
        )}${this.button(`Chain prompts: ${cfg.chains === 'smart' ? 'smart' : 'always ask'}`, () => updateSettings({ chains: cfg.chains === 'smart' ? 'always' : 'smart' }))}${this.button(
          `Auto zone: ${cfg.autoZone ? 'on' : 'off'}`,
          () => updateSettings({ autoZone: !cfg.autoZone }),
        )}${this.button(`Animations: ${cfg.anim}`, () => updateSettings({ anim: cfg.anim === 'normal' ? 'fast' : cfg.anim === 'fast' ? 'off' : 'normal' }))}${
          this.ended ? '' : this.button('Surrender', () => this.surrender(), 'danger')
        }${this.button('Quit to main menu', () => this.opts.onExit())}</div>`;
        break;
    }
    return `<div class="sheet-bg" ${this.h(() => (this.sheet = null))}></div><div class="sheet">${body}<div class="mfoot">${close}</div></div>`;
  }

  private endHtml(): string {
    if (!this.ended || this.endHidden) return '';
    const v = this.u!.view;
    const w = this.ended.winner;
    let title = 'Draw';
    if (w !== null) title = this.opts.hotseat ? `${this.nameOf(w)} wins` : w === v.you ? 'Victory!' : 'Defeat';
    return `<div class="modal end"><div class="mbox"><h1>${esc(title)}</h1><p>${esc(this.ended.reason)}</p><div class="mbtns col">${this.button('View field', () => (this.endHidden = true))}${this.button('Back to menu', () => this.opts.onExit(), 'go')}</div></div></div>`;
  }
}

const RPS: Record<number, string> = { 1: 'Scissors', 2: 'Rock', 3: 'Paper' };

/** Texto de una pista de selección sin los huecos "%ls" que no tenemos. */
const hintText = (t: string) => fmt(t, '').replace(/\s*["「[]\s*["」\]]/g, '');

/** Zonas libres según la máscara del motor (bit a 1 = no disponible; +16 = el rival). */
export function freePlaces(player: number, mask: number): Place[] {
  const out: Place[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if ((mask >>> bit) & 1) continue;
    const owner = bit >= 16 ? 1 - player : player;
    const b = bit % 16;
    if (b < 5) out.push({ player: owner, location: 4, sequence: b });
    else if (b >= 8 && b < 13) out.push({ player: owner, location: 8, sequence: b - 8 });
    else if (b === 13) out.push({ player: owner, location: 8, sequence: 5 });
  }
  return out;
}

