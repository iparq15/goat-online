// Durable Object: una sala de duelo y su árbitro.
//
// - Corre el motor (ocgcore) y manda a cada jugador SOLO lo que puede ver (src/engine/arbiter.ts).
// - Los jugadores solo envían sus respuestas; las inválidas se rechazan (el motor pide
//   repetir la decisión).
// - Usa WebSocket Hibernation: si Cloudflare saca el objeto de memoria, el duelo se
//   reconstruye repitiendo las respuestas guardadas (el motor es determinista).
// - Si un jugador se desconecta durante el duelo y no vuelve en DISCONNECT_FORFEIT_MS, pierde.
// - Avisa al lobby cuando la sala empieza o se abandona.

import { DurableObject } from 'cloudflare:workers';
import type { OcgResponse } from 'ocgcore-wasm';
import { decode, encode } from '../../src/codec.ts';
import { Arbiter, randomSeed } from '../../src/engine/arbiter.ts';
import { validateDeck, type Deck } from '../../src/engine/ydk.ts';
import { DISCONNECT_FORFEIT_MS, PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '../../src/protocol.ts';
import { getCore, getData } from './core.ts';
import type { Lobby } from './lobby.ts';

export interface Env {
  DUEL_ROOM: DurableObjectNamespace<DuelRoom>;
  LOBBY: DurableObjectNamespace<Lobby>;
  /** Solo en desarrollo (server/.dev.vars): permite {t:'debug-restore'} y acorta la derrota por desconexión. */
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
  ended: { winner: 0 | 1 | null; reason: string; at?: number } | null;
}

interface Attachment {
  seat: 0 | 1 | null;
}

const MAX_MSG = 64 * 1024;
/** Una sala en espera sin nadie conectado se cierra a los 60 s. */
const EMPTY_LOBBY_MS = 60 * 1000;
/** Un duelo terminado se borra a la hora. */
const ENDED_KEEP_MS = 60 * 60 * 1000;

export class DuelRoom extends DurableObject<Env> {
  private roomId = '';
  private lobby: (Seat | null)[] = [null, null];
  private match: Match | null = null;
  private arb: Arbiter | null = null;
  /** Asientos con la app en segundo plano (no hace falta guardarlo). */
  private away = new Set<0 | 1>();
  /** Momento en que pierde cada asiento desconectado. */
  private gone: [number | null, number | null] = [null, null];
  private ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.roomId = (await ctx.storage.get<string>('roomId')) ?? '';
      this.lobby = (await ctx.storage.get<(Seat | null)[]>('lobby')) ?? [null, null];
      this.gone = (await ctx.storage.get<[number | null, number | null]>('gone')) ?? [null, null];
      await this.restore();
    });
  }

  // ---------- conexión ----------

  async fetch(req: Request): Promise<Response> {
    await this.ready;
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const id = req.headers.get('X-Room-Id');
    if (id && !this.roomId) {
      this.roomId = id;
      await this.ctx.storage.put('roomId', id);
    }
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
      case 'away':
        if (att.seat === null) return;
        if (msg.away) this.away.add(att.seat);
        else this.away.delete(att.seat);
        return this.notifyOpponentOf(att.seat);
      case 'leave':
        if (att.seat === null || this.match) return;
        await this.leaveLobby(att.seat);
        ws.close(1000, 'left');
        return;
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
    await this.ready;
    const att = ws.deserializeAttachment() as Attachment;
    if (att?.seat === null || att?.seat === undefined) return this.schedule();
    const seat = att.seat;
    if (this.socketsOf(seat, ws).length) return;
    this.away.delete(seat);
    if (this.match && !this.match.ended) {
      // Empieza la cuenta atrás: si no vuelve, pierde.
      // En desarrollo (DEBUG=1) se pierde a los 6 s para poder probarlo.
      this.gone[seat] = Date.now() + (this.env.DEBUG === '1' ? 6000 : DISCONNECT_FORFEIT_MS);
      await this.ctx.storage.put('gone', this.gone);
    }
    this.notifyOpponentOf(seat, ws);
    await this.schedule(ws);
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
      if (this.gone[seat] !== null) {
        this.gone[seat] = null;
        await this.ctx.storage.put('gone', this.gone);
      }
      this.send(ws, { t: 'joined', seat, token: seats[seat]!.token, opponent: this.seatName((1 - seat) as 0 | 1) });
      this.send(ws, this.statusOf((1 - seat) as 0 | 1));
      this.notifyOpponentOf(seat);
      if (this.match) {
        this.sendUpdate(seat, ws, true);
        if (this.match.ended) this.send(ws, { t: 'ended', winner: this.match.ended.winner, reason: this.match.ended.reason });
      }
      await this.schedule();
      return;
    }

    if (this.match) return this.send(ws, { t: 'error', message: msg.token ? 'This duel is no longer available.' : 'This room is already playing.' });
    const seat = this.lobby.findIndex((s) => s === null);
    if (seat < 0) return this.send(ws, { t: 'error', message: 'This room is full.' });

    const deck = sanitizeDeck(msg.deck);
    const problems = validateDeck(deck, getData());
    if (problems.length) return this.send(ws, { t: 'deck-invalid', problems });

    const token = crypto.randomUUID();
    this.lobby[seat] = { name, token, deck };
    await this.ctx.storage.put('lobby', this.lobby);
    ws.serializeAttachment({ seat: seat as 0 | 1 } satisfies Attachment);
    this.send(ws, { t: 'joined', seat: seat as 0 | 1, token, opponent: this.lobby[1 - seat]?.name ?? null });
    if (this.lobby[1 - seat]) this.send(ws, this.statusOf((1 - seat) as 0 | 1));
    this.notifyOpponentOf(seat as 0 | 1);

    if (this.lobby[0] && this.lobby[1]) await this.start();
    else await this.schedule();
  }

  private async leaveLobby(seat: 0 | 1): Promise<void> {
    this.lobby[seat] = null;
    await this.ctx.storage.put('lobby', this.lobby);
    for (const s of this.socketsOf((1 - seat) as 0 | 1)) this.send(s, { t: 'opponent', name: null, connected: false });
    if (!this.lobby[0] && !this.lobby[1]) await this.closeRoom();
  }

  /** Quita la sala del lobby y borra todo. */
  private async closeRoom(): Promise<void> {
    if (this.roomId) await this.env.LOBBY.get(this.env.LOBBY.idFromName('main')).remove(this.roomId);
    this.arb?.destroy();
    this.arb = null;
    this.match = null;
    this.lobby = [null, null];
    this.gone = [null, null];
    const roomId = this.roomId;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    // El código de la sala se conserva por si alguien vuelve a conectarse a ella.
    if (roomId) await this.ctx.storage.put('roomId', roomId);
  }

  // ---------- temporizadores (alarmas) ----------

  async alarm(): Promise<void> {
    await this.ready;
    const now = Date.now();
    if (this.match && !this.match.ended) {
      for (const seat of [0, 1] as const) {
        const dl = this.gone[seat];
        if (dl !== null && dl <= now && !this.socketsOf(seat).length) {
          await this.finish(this.teamOf((1 - seat) as 0 | 1), 'Disconnection');
          break;
        }
      }
    } else if (this.match?.ended) {
      if (now - (this.match.ended.at ?? 0) >= ENDED_KEEP_MS) return this.closeRoom();
    } else if (!this.ctx.getWebSockets().length) {
      return this.closeRoom();
    }
    await this.schedule();
  }

  /** Programa la próxima alarma necesaria. `closing`: socket que se está cerrando (aún aparece). */
  private async schedule(closing?: WebSocket): Promise<void> {
    const now = Date.now();
    let next: number | null = null;
    const consider = (t: number | null) => {
      if (t !== null && (next === null || t < next)) next = t;
    };
    if (this.match && !this.match.ended) {
      consider(this.gone[0]);
      consider(this.gone[1]);
    } else if (this.match?.ended) {
      consider((this.match.ended.at ?? now) + ENDED_KEEP_MS);
    } else if ((this.lobby[0] || this.lobby[1]) && !this.ctx.getWebSockets().filter((w) => w !== closing).length) {
      consider(now + EMPTY_LOBBY_MS);
    }
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(next, now + 100));
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
    await this.ctx.storage.delete('lobby');
    await this.ctx.storage.put('match', this.match);
    if (this.roomId) await this.env.LOBBY.get(this.env.LOBBY.idFromName('main')).remove(this.roomId);
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
    const stored = await this.ctx.storage.list<string>({ prefix: 'r:' });
    const replay = [...stored.values()].map((s) => decode<OcgResponse>(s));
    await this.build(replay);
    if (match.ended) {
      // Duelo terminado: se reconstruye para poder mostrar el campo final al reconectar.
      this.arb!.advance();
      this.arb!.end(match.ended.winner, match.ended.reason);
      this.arb!.flush();
      return;
    }
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
    this.match.ended = { winner: winnerTeam, reason, at: Date.now() };
    this.gone = [null, null];
    await this.ctx.storage.put('match', this.match);
    await this.ctx.storage.put('gone', this.gone);
    for (const seat of [0, 1] as const) {
      for (const ws of this.socketsOf(seat)) {
        this.sendUpdate(seat, ws, false);
        this.send(ws, { t: 'ended', winner: winnerTeam, reason });
      }
    }
    this.arb?.flush();
    await this.schedule();
  }

  private sendUpdate(seat: 0 | 1, ws: WebSocket, resync: boolean): void {
    if (!this.arb) return;
    this.send(ws, this.arb.update(this.teamOf(seat), resync));
  }

  // ---------- estado del rival ----------

  /** Mensaje con el estado de `seat`, para su rival. */
  private statusOf(seat: 0 | 1, closing?: WebSocket): ServerMsg {
    const connected = this.socketsOf(seat, closing).length > 0;
    return {
      t: 'opponent',
      name: this.seatName(seat),
      connected,
      away: connected && this.away.has(seat) ? true : undefined,
      forfeitAt: !connected && this.gone[seat] !== null ? this.gone[seat]! : undefined,
    };
  }

  private notifyOpponentOf(seat: 0 | 1, closing?: WebSocket): void {
    const msg = this.statusOf(seat, closing);
    for (const s of this.socketsOf((1 - seat) as 0 | 1, closing)) this.send(s, msg);
  }

  // ---------- utilidades ----------

  private teamOf(seat: 0 | 1): 0 | 1 {
    return this.match ? this.match.teamOfSeat[seat] : seat;
  }

  private seatName(seat: 0 | 1): string | null {
    return (this.match?.seats ?? this.lobby)[seat]?.name ?? null;
  }

  private socketsOf(seat: 0 | 1, except?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws !== except && (ws.deserializeAttachment() as Attachment | null)?.seat === seat);
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
