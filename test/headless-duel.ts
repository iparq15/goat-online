// Fase 1: duelos GOAT completos sin interfaz, entre dos bots, con mazos .ydk reales.
//   node test/headless-duel.ts [número de duelos] [carpeta de mazos]
// Comprueba que el motor, las cartas y los scripts del pool funcionan y que el duelo es
// reproducible (mismo seed + mismas respuestas = mismo resultado).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import createCore, { OcgMessageType, type OcgMessage } from 'ocgcore-wasm';
import { parseGoatData, type RawGoatData } from '../src/engine/data.ts';
import { GoatDuel } from '../src/engine/duel.ts';
import { parseYdk, validateDeck, type Deck } from '../src/engine/ydk.ts';
import { botRespond, mulberry32, type BotState } from './bot.ts';

const DUELS = Number(process.argv[2] ?? 20);
const DECK_DIR = process.argv[3] ?? 'C:/ProjectIgnis/deck';

const raw: RawGoatData = {
  cards: JSON.parse(readFileSync('data/goat/cards.json', 'utf8')),
  scripts: JSON.parse(readFileSync('data/goat/scripts.json', 'utf8')),
  lflist: JSON.parse(readFileSync('data/goat/lflist.json', 'utf8')),
};
const data = parseGoatData(raw);
const poolCodes = [...data.cards.values()].filter((c) => c.inPool).map((c) => c.code);

// Mazos: los .ydk de la carpeta que sean legales en GOAT.
const decks: { name: string; deck: Deck }[] = [];
for (const f of readdirSync(DECK_DIR).filter((f) => f.endsWith('.ydk'))) {
  const deck = parseYdk(readFileSync(join(DECK_DIR, f), 'utf8'));
  const problems = validateDeck(deck, data);
  if (problems.length) console.log(`  (descartado) ${f}: ${problems[0]}${problems.length > 1 ? ` y ${problems.length - 1} más` : ''}`);
  else decks.push({ name: f.replace(/\.ydk$/, ''), deck });
}
console.log(`Mazos GOAT legales: ${decks.length}`);
if (decks.length < 1) throw new Error('No hay mazos legales para probar.');

const core = await createCore({ sync: true });

interface Result {
  winner: number | null;
  reason: number;
  turns: number;
  decisions: number;
  retries: number;
  errors: string[];
  log: string;
}

function runDuel(i: number): Result {
  const a = decks[i % decks.length];
  const b = decks[(i * 7 + 3) % decks.length];
  const seed = [BigInt(i + 1), 0x9e3779b97f4a7c15n, BigInt(i * 31 + 7), 0xdeadbeefn] as [bigint, bigint, bigint, bigint];
  const rng = mulberry32(1000 + i);
  const duel = new GoatDuel(core, data, { decks: [a.deck, b.deck], seed });
  const st: BotState[] = [{ idleActions: 0 }, { idleActions: 0 }];
  let turns = 0;
  let decisions = 0;
  let retries = 0;
  let attempt = 0;
  let winner: number | null = null;
  let reason = -1;
  const trace: string[] = [];
  for (let guard = 0; guard < 20000; guard++) {
    const r = duel.step();
    for (const m of r.messages as OcgMessage[]) {
      if (m.type === OcgMessageType.NEW_TURN) turns++;
      if (m.type === OcgMessageType.WIN) {
        winner = m.player;
        reason = m.reason;
      }
      trace.push(String(m.type));
    }
    if (r.ended) break;
    if (!r.pending) throw new Error('El motor espera respuesta sin decisión pendiente.');
    attempt = r.retry ? attempt + 1 : 0;
    if (r.retry) retries++;
    if (attempt > 50) throw new Error(`Bucle de RETRY en ${r.pending.type}`);
    if (turns > 60) {
      // Duelo demasiado largo para el bot: se corta (no es un error del motor).
      break;
    }
    const player = 'player' in r.pending ? (r.pending.player as number) : 0;
    duel.respond(botRespond(r.pending, rng, st[player], attempt, poolCodes));
    decisions++;
  }
  const errors = [...duel.errors];
  duel.destroy();
  return { winner, reason, turns, decisions, retries, errors, log: `${a.name} vs ${b.name}` };
}

let finished = 0;
let totalErrors = 0;
const t0 = performance.now();
for (let i = 0; i < DUELS; i++) {
  const r = runDuel(i);
  if (r.winner !== null) finished++;
  totalErrors += r.errors.length;
  console.log(
    `#${String(i + 1).padStart(2)} ${r.log}: ${r.winner === null ? 'cortado' : `gana J${r.winner + 1} (razón ${r.reason})`}` +
      ` · ${r.turns} turnos · ${r.decisions} decisiones · ${r.retries} reintentos` +
      (r.errors.length ? ` · ${r.errors.length} errores de script: ${r.errors.slice(0, 2).join(' | ')}` : ''),
  );
}
console.log(`\n${finished}/${DUELS} duelos terminados · ${totalErrors} errores de script · ${((performance.now() - t0) / 1000).toFixed(1)} s`);

// Reproducibilidad: el mismo duelo dos veces debe dar exactamente lo mismo.
const r1 = runDuel(3);
const r2 = runDuel(3);
console.log(`Reproducible: ${r1.turns === r2.turns && r1.decisions === r2.decisions && r1.winner === r2.winner ? 'sí' : 'NO'} (${r1.turns} turnos, ${r1.decisions} decisiones)`);
