// Duelo local (práctica en el mismo móvil): el mismo árbitro que usa el servidor, pero en
// el navegador. Cada asiento recibe los mismos mensajes que recibiría por WebSocket.

import type { OcgCoreSync } from 'ocgcore-wasm';
import type { GoatData } from '../engine/data.ts';
import { Arbiter, randomSeed } from '../engine/arbiter.ts';
import type { Deck } from '../engine/ydk.ts';
import type { ClientMsg, ServerMsg } from '../protocol.ts';

export interface DuelLink {
  send(msg: ClientMsg): void;
}

export class LocalHost {
  private arb: Arbiter;
  /** Equipo (0 = empieza) de cada asiento. */
  readonly teamOfSeat: [0 | 1, 0 | 1];
  private listeners: [(m: ServerMsg) => void, (m: ServerMsg) => void] = [() => {}, () => {}];
  private names: [string, string];
  private finished = false;

  /** `firstSeat`: asiento que empieza (lo decide el volado); sin él, al azar. */
  constructor(core: OcgCoreSync, data: GoatData, decks: [Deck, Deck], names: [string, string], firstSeat?: 0 | 1) {
    this.names = names;
    const first = firstSeat ?? crypto.getRandomValues(new Uint8Array(1))[0] & 1;
    this.teamOfSeat = first === 0 ? [0, 1] : [1, 0];
    const byTeam: [Deck, Deck] = first === 0 ? decks : [decks[1], decks[0]];
    this.arb = new Arbiter(core, data, byTeam, randomSeed());
  }

  /** Conexión de un asiento (lo que en el modo online sería el WebSocket). */
  link(seat: 0 | 1, onMessage: (m: ServerMsg) => void): DuelLink {
    this.listeners[seat] = onMessage;
    return { send: (msg) => queueMicrotask(() => this.receive(seat, msg)) };
  }

  start(): void {
    for (const seat of [0, 1] as const) {
      this.emit(seat, { t: 'joined', seat, token: 'local', opponent: this.names[1 - seat] });
    }
    this.advance();
  }

  private receive(seat: 0 | 1, msg: ClientMsg): void {
    if (this.finished) return;
    const team = this.teamOfSeat[seat];
    if (msg.t === 'surrender') {
      this.arb.surrender(team);
      return this.finish();
    }
    if (msg.t !== 'respond') return;
    const r = this.arb.respond(team, msg.seq, msg.response);
    if (r.kind === 'ignored') return;
    if (r.kind === 'invalid') return this.emit(seat, this.arb.update(team));
    this.advance();
  }

  private advance(): void {
    this.arb.advance();
    if (this.arb.ended) return this.finish();
    for (const seat of [0, 1] as const) this.emit(seat, this.arb.update(this.teamOfSeat[seat]));
    this.arb.flush();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    const end = this.arb.ended!;
    for (const seat of [0, 1] as const) {
      this.emit(seat, this.arb.update(this.teamOfSeat[seat]));
      this.emit(seat, { t: 'ended', winner: end.winner, reason: end.reason });
    }
    this.arb.flush();
  }

  private emit(seat: 0 | 1, m: ServerMsg): void {
    this.listeners[seat](m);
  }

  destroy(): void {
    this.finished = true;
    this.arb.destroy();
  }
}
