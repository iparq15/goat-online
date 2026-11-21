// Durable Object: una sala de duelo y su árbitro.
//
// - Corre el motor (ocgcore) y manda a cada jugador SOLO lo que puede ver (src/engine/arbiter.ts).
// - Los jugadores solo envían sus respuestas; las inválidas se rechazan (el motor pide
//   repetir la decisión).
// - Usa WebSocket Hibernation: si Cloudflare saca el objeto de memoria, el duelo se
//   reconstruye repitiendo las respuestas guardadas (el motor es determinista).

import { DurableObject } from 'cloudflare:workers';
import type { OcgResponse } from 'ocgcore-wasm';
import { decode, encode } from '../../src/codec.ts';
import { Arbiter, randomSeed } from '../../src/engine/arbiter.ts';
import { validateDeck, type Deck } from '../../src/engine/ydk.ts';
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '../../src/protocol.ts';
import { getCore, getData } from './core.ts';

export interface Env {
  DUEL_ROOM: DurableObjectNamespace<DuelRoom>;
  /** Solo en desarrollo (server/.dev.vars): permite {t:'debug-restore'}. */
  DEBUG?: string;
}

interface Seat {
  name: string;
  token: string;
  deck: Deck;
}

/** Lo que hace falta para reconstruir el duelo. */
interface Match {
  seats: [Seat, Seat];
  /** Equipo (0 = empieza) de cada asiento. */
  teamOfSeat: [0 | 1, 0 | 1];
  seed: [string, string, string, string];
  ended: { winner: 0 | 1 | null; reason: string } | null;
}

interface Attachment {
  seat: 0 | 1 | null;
}

const MAX_MSG = 64 * 1024;

export class DuelRoom extends DurableObject<Env> {
  private lobby: (Seat | null)[] = [null, null];
  private match: Match | null = null;
  private arb: Arbiter | null = null;
  private ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(() => this.restore());
  }

  // ---------- conexión ----------

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.ready;
    if (typeof raw !== 'string' || raw.length > MAX_MSG) return this.send(ws, { t: 'error', message: 'Invalid message.' });
    let msg: ClientMsg;
    try {
      msg = decode<ClientMsg>(raw);
    } catch {
      return this.send(ws, { t: 'error', message: 'Invalid message.' });
    }
    const att = ws.deserializeAttachment() as Attachment;
    switch (msg.t) {
      case 'ping':
        return this.send(ws, { t: 'pong' });
      case 'join':
        return this.onJoin(ws, msg);
      case 'respond':
        if (att.seat === null) return;
        return this.onRespond(att.seat, msg.seq, msg.response);
      case 'debug-restore':
        // Simula que Cloudflare sacó el objeto de memoria: se reconstruye desde el almacenamiento.
        if (this.env.DEBUG !== '1') return;
        this.arb?.destroy();
        this.arb = null;
        await this.restore();
        return;
      case 'surrender':
        if (att.seat === null || !this.match || this.match.ended) return;
        return this.finish(this.teamOf(att.seat) === 0 ? 1 : 0, 'Surrender');
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment;
    if (att?.seat === null || att?.seat === undefined) return;
    const other = (1 - att.seat) as 0 | 1;
    if (!this.socketsOf(att.seat).length) {
      for (const s of this.socketsOf(other)) this.send(s, { t: 'opponent', name: this.seatName(att.seat), connected: false });
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private async onJoin(ws: WebSocket, msg: Extract<ClientMsg, { t: 'join' }>): Promise<void> {
    if (msg.v !== PROTOCOL_VERSION) return this.send(ws, { t: 'error', message: 'App version mismatch: reload the page.' });
    const name = String(msg.name ?? '').trim().slice(0, 24) || 'Player';

    // Reconexión con el token de un asiento.
    const seats = this.match?.seats ?? this.lobby;
    const back = msg.token ? seats.findIndex((s) => s?.token === msg.token) : -1;
    if (back >= 0) {
      const seat = back as 0 | 1;
      ws.serializeAttachment({ seat } satisfies Attachment);
      this.send(ws, { t: 'joined', seat, token: seats[seat]!.token, opponent: this.seatName((1 - seat) as 0 | 1) });
      for (const s of this.socketsOf((1 - seat) as 0 | 1)) this.send(s, { t: 'opponent', name: this.seatName(seat), connected: true });
      if (this.match) this.sendUpdate(seat, ws, true);
      return;
    }

    if (this.match) return this.send(ws, { t: 'error', message: 'This room is already playing.' });
    const seat = this.lobby.findIndex((s) => s === null);
    if (seat < 0) return this.send(ws, { t: 'error', message: 'This room is full.' });

    const deck = sanitizeDeck(msg.deck);
    const problems = validateDeck(deck, getData());
    if (problems.length) return this.send(ws, { t: 'deck-invalid', problems });

    const token = crypto.randomUUID();
    this.lobby[seat] = { name, token, deck };
    ws.serializeAttachment({ seat: seat as 0 | 1 } satisfies Attachment);
    this.send(ws, { t: 'joined', seat: seat as 0 | 1, token, opponent: this.lobby[1 - seat]?.name ?? null });
    for (const s of this.socketsOf((1 - seat) as 0 | 1)) this.send(s, { t: 'opponent', name, connected: true });

    if (this.lobby[0] && this.lobby[1]) await this.start();
  }

  // ---------- duelo ----------

  private async start(): Promise<void> {
    const firstSeat = crypto.getRandomValues(new Uint8Array(1))[0] & 1;
    this.match = {
      seats: [this.lobby[0]!, this.lobby[1]!],
      teamOfSeat: firstSeat === 0 ? [0, 1] : [1, 0],
      seed: randomSeed().map(String) as Match['seed'],
      ended: null,
    };
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put('match', this.match);
    await this.build([]);
    await this.advance();
  }

  /** Crea el motor del duelo y repite las respuestas dadas (reconstrucción). */
  private async build(replay: OcgResponse[]): Promise<void> {
    const m = this.match!;
    const decks: [Deck, Deck] = [m.seats[0].deck, m.seats[1].deck];
    // decks[equipo]: el equipo 0 es el que empieza.
    const byTeam: [Deck, Deck] = m.teamOfSeat[0] === 0 ? decks : [decks[1], decks[0]];
    this.arb?.destroy();
    this.arb = new Arbiter(await getCore(), getData(), byTeam, m.seed.map(BigInt) as [bigint, bigint, bigint, bigint], replay);
  }

  private async restore(): Promise<void> {
    const match = await this.ctx.storage.get<Match>('match');
    if (!match) return;
    this.match = match;
    if (match.ended) return;
    const stored = await this.ctx.storage.list<string>({ prefix: 'r:' });
    const replay = [...stored.values()].map((s) => decode<OcgResponse>(s));
    await this.build(replay);
    await this.advance(false);
    // Tras reconstruir, cada jugador recibe el estado actual.
    for (const seat of [0, 1] as const) for (const ws of this.socketsOf(seat)) this.sendUpdate(seat, ws, true);
  }

  /** Avanza hasta la siguiente decisión y manda a cada jugador su actualización. */
  private async advance(broadcast = true): Promise<void> {
    const arb = this.arb!;
    arb.advance();
    if (arb.ended) return this.finish(arb.ended.winner, arb.ended.reason);
    if (broadcast) for (const seat of [0, 1] as const) for (const ws of this.socketsOf(seat)) this.sendUpdate(seat, ws, false);
    arb.flush();
  }

  private async onRespond(seat: 0 | 1, seq: number, raw: unknown): Promise<void> {
    const arb = this.arb;
    if (!arb || this.match?.ended) return;
    const r = arb.respond(this.teamOf(seat), seq, raw);
    if (r.kind === 'ignored') return;
    if (r.kind === 'invalid') {
      // Respuesta mal formada: no llega al motor y se vuelve a pedir la misma decisión.
      for (const ws of this.socketsOf(seat)) this.sendUpdate(seat, ws, false);
      return;
    }
    await this.ctx.storage.put(`r:${String(arb.responses - 1).padStart(7, '0')}`, encode(r.response));
    await this.advance();
  }

  private async finish(winnerTeam: 0 | 1 | null, reason: string): Promise<void> {
    if (!this.match || this.match.ended) return;
    this.arb?.end(winnerTeam, reason);
    this.match.ended = { winner: winnerTeam, reason };
    await this.ctx.storage.put('match', this.match);
    for (const seat of [0, 1] as const) {
      for (const ws of this.socketsOf(seat)) {
        this.sendUpdate(seat, ws, false);
        this.send(ws, { t: 'ended', winner: winnerTeam, reason });
      }
    }
    this.arb?.flush();
  }

  private sendUpdate(seat: 0 | 1, ws: WebSocket, resync: boolean): void {
    if (!this.arb) return;
    this.send(ws, this.arb.update(this.teamOf(seat), resync));
  }

  // ---------- utilidades ----------

  private teamOf(seat: 0 | 1): 0 | 1 {
    return this.match ? this.match.teamOfSeat[seat] : seat;
  }

  private seatName(seat: 0 | 1): string | null {
    return (this.match?.seats ?? this.lobby)[seat]?.name ?? null;
  }

  private socketsOf(seat: 0 | 1): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() as Attachment | null)?.seat === seat);
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(encode(msg));
    } catch {
      /* socket cerrado */
    }
  }
}

function sanitizeDeck(d: Partial<Deck> | undefined): Deck {
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((n) => Number.isInteger(n) && n > 0).slice(0, 90) : []);
  return { main: list(d?.main), extra: list(d?.extra), side: list(d?.side) };
}
