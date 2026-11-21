// Fase 2: dos bots juegan contra el servidor de duelos (WebSocket) y se comprueba que el
// árbitro no filtra información oculta.
//   node test/server-duel.ts [url-base] [duelos]
//   (por defecto ws://localhost:8788)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { OcgMessageType, OcgPosition, type OcgMessage } from 'ocgcore-wasm';
import { decode, encode } from '../src/codec.ts';
import { parseGoatData, type RawGoatData } from '../src/engine/data.ts';
import { parseYdk, validateDeck, type Deck } from '../src/engine/ydk.ts';
import { PROTOCOL_VERSION, type ClientMsg, type DuelView, type ServerMsg } from '../src/protocol.ts';
import { botRespond, mulberry32, type BotState } from './bot.ts';

const BASE = process.argv[2] ?? 'ws://localhost:8788';
const DUELS = Number(process.argv[3] ?? 3);

const data = parseGoatData({
  cards: JSON.parse(readFileSync('data/goat/cards.json', 'utf8')),
  scripts: {},
  lflist: JSON.parse(readFileSync('data/goat/lflist.json', 'utf8')),
} as RawGoatData);
const poolCodes = [...data.cards.values()].filter((c) => c.inPool).map((c) => c.code);
const DECK_DIR = 'C:/ProjectIgnis/deck';
const decks: Deck[] = readdirSync(DECK_DIR)
  .filter((f) => f.endsWith('.ydk'))
  .map((f) => parseYdk(readFileSync(join(DECK_DIR, f), 'utf8')))
  .filter((d) => validateDeck(d, data).length === 0);

const FACEUP = OcgPosition.FACEUP;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Comprobaciones de que `you` no recibe nada oculto del rival. */
function checkView(v: DuelView, leaks: string[]): void {
  const opp = v.players[1 - v.you];
  opp.hand.forEach((c, i) => c.code && leaks.push(`mano rival[${i}] visible (${c.code})`));
  [...opp.monsters, ...opp.spells].forEach((c, i) => {
    if (c && c.code && !(c.position & FACEUP)) leaks.push(`carta boca abajo rival[${i}] visible (${c.code})`);
  });
  if (opp.extra.length) leaks.push('Extra Deck rival visible');
  opp.banished.forEach((c) => c.code && !(c.position & FACEUP) && leaks.push('desterrada boca abajo rival visible'));
}

function checkEvents(you: number, events: OcgMessage[], leaks: string[]): void {
  for (const m of events) {
    if (m.type === OcgMessageType.DRAW && m.player !== you && m.drawn.some((d) => d.code && !(d.position & FACEUP))) leaks.push('robo del rival visible');
    if (m.type === OcgMessageType.SET && m.controller !== you && m.code) leaks.push('carta colocada por el rival visible');
    if (m.type === OcgMessageType.SHUFFLE_HAND && m.player !== you && m.cards.some((c) => c)) leaks.push('mano barajada del rival visible');
    if (m.type === OcgMessageType.HINT && m.player !== you) leaks.push('pista para el rival recibida');
    if (m.type === OcgMessageType.MOVE && m.card) {
      const hidden = (l: { controller: number; location: number; position: number }) =>
        l.location === 1 || (l.location === 2 && l.controller !== you) || ((l.location === 4 || l.location === 8) && l.controller !== you && !(l.position & FACEUP));
      if (hidden(m.from) && hidden(m.to)) leaks.push(`movimiento oculto del rival visible (${m.card})`);
    }
  }
}

/** En las decisiones no puede aparecer el código de una carta oculta del rival. */
function checkPrompt(you: number, p: OcgMessage, leaks: string[]): void {
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    const r = o as Record<string, number>;
    if (typeof r.code === 'number' && r.code && typeof r.controller === 'number' && r.controller !== you) {
      const facedown = typeof r.position === 'number' && !(r.position & FACEUP);
      if (r.location === 1 || r.location === 2 || r.location === 64 || ((r.location === 4 || r.location === 8) && facedown)) {
        leaks.push(`decisión con carta oculta del rival (${r.code})`);
      }
    }
    Object.values(o).forEach(walk);
  };
  walk(p);
}

class BotClient {
  ws!: WebSocket;
  seat: 0 | 1 | null = null;
  token = '';
  last: Extract<ServerMsg, { t: 'update' }> | null = null;
  ended: Extract<ServerMsg, { t: 'ended' }> | null = null;
  leaks: string[] = [];
  updates = 0;
  prompts = 0;
  retries = 0;
  private st: BotState = { idleActions: 0 };
  private attempt = 0;
  paused = false;

  readonly name: string;
  readonly url: string;
  readonly deck: Deck;
  readonly rng: () => number;

  constructor(name: string, url: string, deck: Deck, rng: () => number) {
    this.name = name;
    this.url = url;
    this.deck = deck;
    this.rng = rng;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        this.send({ t: 'join', v: PROTOCOL_VERSION, name: this.name, deck: this.deck, token: this.token || undefined });
        resolve();
      };
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (e) => this.onMessage(decode<ServerMsg>(String(e.data)));
    });
  }

  send(m: ClientMsg): void {
    this.ws.send(encode(m));
  }

  respondNow(): void {
    const m = this.last;
    if (!m?.prompt) return;
    this.prompts++;
    this.attempt = m.retry ? this.attempt + 1 : 0;
    this.send({ t: 'respond', seq: m.seq, response: botRespond(m.prompt, this.rng, this.st, this.attempt, poolCodes) });
  }

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'joined':
        this.seat = m.seat;
        this.token = m.token;
        break;
      case 'update': {
        this.updates++;
        this.last = m;
        checkView(m.view, this.leaks);
        checkEvents(m.view.you, m.events, this.leaks);
        if (m.prompt && m.waitingFor !== m.view.you) this.leaks.push('decisión recibida sin que me toque');
        if (m.prompt) checkPrompt(m.view.you, m.prompt, this.leaks);
        if (m.retry) this.retries++;
        if (m.prompt && !this.paused) this.respondNow();
        break;
      }
      case 'ended':
        this.ended = m;
        break;
      case 'deck-invalid':
      case 'error':
        console.log(`  [${this.name}] ${m.t}:`, 'problems' in m ? m.problems : m.message);
        break;
    }
  }
}

async function runDuel(i: number): Promise<boolean> {
  const room = `test-${Date.now()}-${i}`;
  const url = `${BASE}/api/duel/${room}`;
  const a = new BotClient('Ana', url, decks[i % decks.length], mulberry32(10 + i));
  const b = new BotClient('Beto', url, decks[(i * 5 + 2) % decks.length], mulberry32(90 + i));
  await a.connect();
  await sleep(100);
  await b.connect();

  // Pruebas de árbitro en el primer duelo.
  let reconnected = false;
  let illegalTried = false;
  let restored = false;
  const t0 = Date.now();
  while (!a.ended || !b.ended) {
    await sleep(50);
    const turn = a.last?.view.turn ?? 0;
    if (i === 0 && !illegalTried && turn >= 2 && a.last && b.last) {
      illegalTried = true;
      a.paused = b.paused = true;
      await sleep(400);
      const active = a.last.waitingFor === a.last.view.you ? a : b;
      const idle = active === a ? b : a;
      const seqBefore = active.last!.seq;
      // 1) Quien NO decide manda una respuesta: se ignora (no cambia nada).
      idle.send({ t: 'respond', seq: idle.last!.seq, response: { type: 1, action: 7, index: null } as never });
      await sleep(300);
      // 2) Quien decide manda basura: el servidor debe volver a pedir la misma decisión.
      const r0 = active.retries;
      active.send({ t: 'respond', seq: seqBefore, response: { type: 99, foo: 'x' } as never });
      await sleep(500);
      const retried = active.retries > r0 && active.last!.seq === seqBefore;
      console.log(`  · fuera de turno ignorada: ${active.last!.seq === seqBefore ? 'sí' : 'NO'} · basura rechazada y vuelta a pedir: ${retried ? 'sí' : 'NO'}`);
      if (!retried) active.leaks.push('la respuesta basura no se rechazó');
      a.paused = b.paused = false;
      active.respondNow();
    }
    if (i === 0 && !reconnected && turn >= 6) {
      reconnected = true;
      b.paused = true;
      b.ws.close();
      await sleep(300);
      b.paused = false;
      await b.connect();
      console.log(`  · Beto se desconectó y volvió con su token (asiento ${b.seat})`);
    }
    if (i === 0 && !restored && turn >= 10 && a.last) {
      restored = true;
      a.paused = b.paused = true;
      await sleep(400);
      const before = JSON.stringify([a.last.view, a.last.seq, b.last!.view, b.last!.seq]);
      a.send({ t: 'debug-restore' });
      await sleep(1500);
      const after = JSON.stringify([a.last.view, a.last.seq, b.last!.view, b.last!.seq]);
      console.log(`  · sala reconstruida desde el almacenamiento: estado ${before === after ? 'idéntico' : 'DISTINTO'}`);
      if (before !== after) a.leaks.push('la reconstrucción cambió el estado');
      a.paused = b.paused = false;
      a.respondNow();
      b.respondNow();
    }
    if (turn > 80 && !a.ended) {
      a.send({ t: 'surrender' });
      await sleep(300);
    }
    if (Date.now() - t0 > 120_000) {
      console.log('  ¡Tiempo agotado!');
      break;
    }
  }
  const leaks = [...new Set([...a.leaks, ...b.leaks])];
  const v = a.last?.view;
  console.log(
    `#${i + 1} sala ${room}: ${a.ended ? `gana ${a.ended.winner === null ? 'nadie' : a.ended.winner === a.last?.view.you ? 'Ana' : 'Beto'} (${a.ended.reason})` : 'sin terminar'}` +
      ` · turno ${v?.turn} · LP ${v?.players[0].lp}/${v?.players[1].lp} · ${a.updates + b.updates} actualizaciones · ${a.prompts + b.prompts} decisiones · ${a.retries + b.retries} reintentos` +
      ` · fugas de información: ${leaks.length ? leaks.slice(0, 5).join('; ') : 'ninguna'}`,
  );
  a.ws.close();
  b.ws.close();
  return !!a.ended && leaks.length === 0;
}

let ok = 0;
for (let i = 0; i < DUELS; i++) if (await runDuel(i)) ok++;
console.log(`\n${ok}/${DUELS} duelos correctos y sin fugas.`);
process.exit(0);
