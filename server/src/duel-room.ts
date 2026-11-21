// Durable Object: una sala de duelo y su árbitro.
//
// - Corre el motor (ocgcore) y manda a cada jugador SOLO lo que puede ver.
// - Los jugadores solo envían sus respuestas; las inválidas se rechazan (el motor pide
//   repetir la decisión).
// - Usa WebSocket Hibernation: si Cloudflare saca el objeto de memoria, el duelo se
//   reconstruye repitiendo las respuestas guardadas (el motor es determinista).

import { DurableObject } from 'cloudflare:workers';
import type { OcgMessage, OcgResponse } from 'ocgcore-wasm';
import { decode, encode } from '../../src/codec.ts';
import { GoatDuel } from '../../src/engine/duel.ts';
import { filterEvent, sanitizePrompt } from '../../src/engine/visibility.ts';
import { checkResponse } from '../../src/engine/validate.ts';
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
  private duel: GoatDuel | null = null;
  private responses = 0;
  private pending: OcgMessage | null = null;
  private retry = false;
  /** Eventos pendientes de enviar a cada equipo. */
  private outbox: [OcgMessage[], OcgMessage[]] = [[], []];
  private ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(() => this.restore());
  }

  // ---------- conexión ----------

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Se esperaba un WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.ready;
    if (typeof raw !== 'string' || raw.length > MAX_MSG) return this.send(ws, { t: 'error', message: 'Mensaje no válido.' });
    let msg: ClientMsg;
    try {
      msg = decode<ClientMsg>(raw);
    } catch {
      return this.send(ws, { t: 'error', message: 'Mensaje no válido.' });
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
        this.duel?.destroy();
        this.duel = null;
        this.pending = null;
        await this.restore();
        return;
      case 'surrender':
        if (att.seat === null || !this.match || this.match.ended) return;
        return this.finish(this.teamOf(att.seat) === 0 ? 1 : 0, 'Rendición');
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
    if (msg.v !== PROTOCOL_VERSION) return this.send(ws, { t: 'error', message: 'Versión de la app distinta: recarga la página.' });
    const name = String(msg.name ?? '').trim().slice(0, 24) || 'Jugador';

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

    if (this.match) return this.send(ws, { t: 'error', message: 'La sala ya está jugando.' });
    const seat = this.lobby.findIndex((s) => s === null);
    if (seat < 0) return this.send(ws, { t: 'error', message: 'La sala está llena.' });

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
    const rnd = new BigUint64Array(4);
    crypto.getRandomValues(rnd);
    if (rnd.every((x) => x === 0n)) rnd[0] = 1n;
    const firstSeat = crypto.getRandomValues(new Uint8Array(1))[0] & 1;
    this.match = {
      seats: [this.lobby[0]!, this.lobby[1]!],
      teamOfSeat: firstSeat === 0 ? [0, 1] : [1, 0],
      seed: [...rnd].map(String) as Match['seed'],
      ended: null,
    };
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put('match', this.match);
    await this.build([]);
    this.advance();
  }

  /** Crea el motor del duelo y repite las respuestas dadas (reconstrucción). */
  private async build(replay: OcgResponse[]): Promise<void> {
    const m = this.match!;
    const core = await getCore();
    const decks: [Deck, Deck] = [m.seats[0].deck, m.seats[1].deck];
    // decks[equipo]: el equipo 0 es el que empieza.
    const byTeam: [Deck, Deck] = m.teamOfSeat[0] === 0 ? decks : [decks[1], decks[0]];
    this.duel?.destroy();
    this.duel = new GoatDuel(core, getData(), { decks: byTeam, seed: m.seed.map(BigInt) as [bigint, bigint, bigint, bigint] });
    this.responses = 0;
    for (const r of replay) {
      this.duel.step();
      this.duel.respond(r);
      this.responses++;
    }
  }

  private async restore(): Promise<void> {
    const match = await this.ctx.storage.get<Match>('match');
    if (!match) return;
    this.match = match;
    if (match.ended) return;
    const stored = await this.ctx.storage.list<string>({ prefix: 'r:' });
    const replay = [...stored.values()].map((s) => decode<OcgResponse>(s));
    await this.build(replay);
    this.advance(false);
    // Tras reconstruir, cada jugador recibe el estado actual.
    for (const seat of [0, 1] as const) for (const ws of this.socketsOf(seat)) this.sendUpdate(seat, ws, true);
  }

  /** Avanza hasta la siguiente decisión y manda a cada jugador su actualización. */
  private advance(broadcast = true): void {
    const duel = this.duel!;
    const r = duel.step();
    for (const m of r.messages) {
      for (const team of [0, 1] as const) {
        const f = filterEvent(team, m);
        if (f) this.outbox[team].push(f);
      }
    }
    this.retry = r.retry;
    this.pending = r.pending;
    if (r.ended) {
      const win = r.messages.find((m) => m.type === 5) as { player: number; reason: number } | undefined;
      void this.finish(win ? ((win.player & 1) as 0 | 1) : null, winReason(win?.reason));
      return;
    }
    if (broadcast) for (const seat of [0, 1] as const) for (const ws of this.socketsOf(seat)) this.sendUpdate(seat, ws, false);
    this.outbox = [[], []];
  }

  private async onRespond(seat: 0 | 1, seq: number, raw: unknown): Promise<void> {
    if (!this.duel || !this.pending || this.match?.ended) return;
    const team = this.teamOf(seat);
    const waiting = ('player' in this.pending ? this.pending.player : -1) as number;
    if (waiting !== team || seq !== this.responses) return; // no le toca o respuesta antigua
    const response = checkResponse(this.pending, raw);
    let ok = response !== null;
    if (response) {
      try {
        this.duel.respond(response);
      } catch {
        ok = false;
      }
    }
    if (!ok || !response) {
      // Respuesta mal formada: no llega al motor y se vuelve a pedir la misma decisión.
      this.retry = true;
      for (const ws of this.socketsOf(seat)) this.sendUpdate(seat, ws, false);
      return;
    }
    await this.ctx.storage.put(`r:${String(this.responses).padStart(7, '0')}`, encode(response));
    this.responses++;
    this.advance();
  }

  private async finish(winnerTeam: 0 | 1 | null, reason: string): Promise<void> {
    if (!this.match || this.match.ended) return;
    this.match.ended = { winner: winnerTeam, reason };
    this.pending = null;
    await this.ctx.storage.put('match', this.match);
    for (const seat of [0, 1] as const) {
      for (const ws of this.socketsOf(seat)) {
        this.sendUpdate(seat, ws, false);
        this.send(ws, { t: 'ended', winner: winnerTeam, reason });
      }
    }
    this.outbox = [[], []];
  }

  private sendUpdate(seat: 0 | 1, ws: WebSocket, resync: boolean): void {
    if (!this.duel) return;
    const team = this.teamOf(seat);
    const p = this.pending;
    const waitingFor = p && 'player' in p ? ((p.player & 1) as 0 | 1) : null;
    const duel = this.duel;
    this.send(ws, {
      t: 'update',
      // Número de respuestas dadas: no cambia al reconstruir el duelo tras hibernar.
      seq: this.responses,
      view: duel.view(team),
      events: resync ? [] : this.outbox[team],
      prompt: p && waitingFor === team ? sanitizePrompt(team, p, (c, l, s) => duel.isFaceUp(c, l, s)) : null,
      waitingFor: this.match?.ended ? null : waitingFor,
      retry: waitingFor === team && this.retry ? true : undefined,
    });
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

function winReason(r: number | undefined): string {
  switch (r) {
    case 1:
      return 'LP a 0';
    case 2:
      return 'Sin cartas en el mazo';
    case 3:
      return 'Tiempo agotado';
    case 4:
      return 'Desconexión';
    default:
      return 'Fin del duelo';
  }
}
