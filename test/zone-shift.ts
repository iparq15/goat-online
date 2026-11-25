// Detector: ninguna carta del campo debe cambiar de zona sin un mensaje del motor que lo explique.
//   node test/zone-shift.ts [duelos]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import createCore, { type OcgMessage } from 'ocgcore-wasm';
import { parseGoatData, type RawGoatData } from '../src/engine/data.ts';
import { GoatDuel } from '../src/engine/duel.ts';
import { parseYdk, validateDeck, type Deck } from '../src/engine/ydk.ts';
import { botRespond, mulberry32, type BotState } from './bot.ts';

const DUELS = Number(process.argv[2] ?? 10);
const raw: RawGoatData = {
  cards: JSON.parse(readFileSync('data/goat/cards.json', 'utf8')),
  scripts: JSON.parse(readFileSync('data/goat/scripts.json', 'utf8')),
  lflist: JSON.parse(readFileSync('data/goat/lflist.json', 'utf8')),
};
const data = parseGoatData(raw);
const poolCodes = [...data.cards.values()].filter((c) => c.inPool).map((c) => c.code);
const decks: Deck[] = [];
for (const f of readdirSync('C:/ProjectIgnis/deck').filter((f) => f.endsWith('.ydk'))) {
  const d = parseYdk(readFileSync(join('C:/ProjectIgnis/deck', f), 'utf8'));
  if (!validateDeck(d, data).length) decks.push(d);
}
const core = await createCore({ sync: true });

/** Zonas del campo (cada jugador ve las suyas sin ocultar). */
function zones(duel: GoatDuel): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of [0, 1] as const) {
    const pl = duel.view(p).players[p]!;
    pl.monsters.forEach((c, s) => out.set(`${p}:4:${s}`, c?.code ?? 0));
    pl.spells.forEach((c, s) => out.set(`${p}:8:${s}`, c?.code ?? 0));
  }
  return out;
}

/** Zonas que menciona un mensaje (cualquier objeto con controller/location/sequence). */
function touched(m: unknown, acc: Set<string>): void {
  if (!m || typeof m !== 'object') return;
  const o = m as Record<string, unknown>;
  if (typeof o.controller === 'number' && typeof o.location === 'number' && typeof o.sequence === 'number') {
    const loc = o.location === 256 ? 8 : (o.location as number) & 0xc;
    if (loc === 4 || loc === 8) acc.add(`${o.controller}:${loc}:${o.location === 256 ? 5 : o.sequence}`);
  }
  for (const v of Object.values(o)) if (v && typeof v === 'object') touched(v, acc);
}

let shifts = 0;
let changes = 0;
for (let i = 0; i < DUELS; i++) {
  const seed = [BigInt(i + 11), 0x9e3779b97f4a7c15n, BigInt(i * 17 + 3), 0xabcdefn] as [bigint, bigint, bigint, bigint];
  const duel = new GoatDuel(core, data, { decks: [decks[i % decks.length]!, decks[(i * 5 + 1) % decks.length]!], seed });
  const rng = mulberry32(77 + i);
  const st: BotState[] = [{ idleActions: 0 }, { idleActions: 0 }];
  let before = zones(duel);
  let turns = 0;
  for (let g = 0; g < 20000; g++) {
    const r = duel.step();
    const msgs = r.messages as OcgMessage[];
    const acc = new Set<string>();
    for (const m of msgs) {
      touched(m, acc);
      if ((m as { type: number }).type === 40) turns++;
    }
    const after = zones(duel);
    for (const [k, code] of after) {
      if (code !== before.get(k)) changes++;
      if (code !== before.get(k) && !acc.has(k)) {
        shifts++;
        if (shifts <= 10) console.log(`duelo ${i + 1}: zona ${k} cambia ${before.get(k)} -> ${code} sin mensaje; mensajes: ${msgs.map((m) => (m as { type: number }).type).join(',')}`);
      }
    }
    before = after;
    if (r.ended || turns > 40 || !r.pending) break;
    const player = 'player' in r.pending ? (r.pending.player as number) : 0;
    duel.respond(botRespond(r.pending, rng, st[player]!, r.retry ? 1 : 0, poolCodes));
  }
  duel.destroy();
}
console.log(`Cambios de zona: ${changes} · sin explicación: ${shifts}`);
