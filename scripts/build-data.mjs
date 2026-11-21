// Genera los datos del cardpool GOAT a partir de Project Ignis (EDOPro):
//   data/goat/cards.json    cartas del pool + las que necesitan sus scripts (fichas, alias…)
//   data/goat/scripts.json  scripts Lua de esas cartas + los scripts comunes (utility, constant…)
//   data/goat/lflist.json   límites GOAT (0 = prohibida, 1, 2, 3)
//
// Fuente: PROJECT_IGNIS (por defecto C:\ProjectIgnis). Se aplican encima las actualizaciones
// de repositories/delta-bagooska, como hace EDOPro. Los scripts y datos son de Project Ignis
// (AGPL-3.0); los textos de las cartas son de Konami.
//
//   node scripts/build-data.mjs

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.env.PROJECT_IGNIS ?? 'C:/ProjectIgnis';
const DELTA = join(SRC, 'repositories/delta-bagooska');
const OUT = 'data/goat';

const first = (...paths) => paths.find((p) => existsSync(p));

// ---------- lista GOAT ----------
const lflistPath = first(join(SRC, 'repositories/lflists/GOAT.lflist.conf'), join(SRC, 'lflists/GOAT.lflist.conf'));
if (!lflistPath) throw new Error(`No encuentro GOAT.lflist.conf en ${SRC}`);
const lflist = {};
let listName = '';
for (const raw of readFileSync(lflistPath, 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (line.startsWith('!')) listName = line.slice(1).trim();
  const m = line.match(/^(\d+)\s+(-?\d+)/);
  if (m) lflist[Number(m[1])] = Number(m[2]);
}
const pool = new Set(Object.keys(lflist).map(Number));

// ---------- bases de datos (base y luego delta, que sobrescribe) ----------
const dbFiles = [
  ...['cards.cdb', 'goat-entries.cdb', 'cards-unofficial.cdb'].map((f) => join(SRC, 'expansions', f)),
  ...['cards.delta.cdb', 'goat-entries.delta.cdb', 'cards-unofficial.delta.cdb'].map((f) => join(DELTA, f)),
].filter((f) => existsSync(f));

const allCards = new Map();
for (const f of dbFiles) {
  const db = new DatabaseSync(f, { readOnly: true });
  const st = db.prepare(
    `SELECT d.id, d.ot, d.alias, d.setcode, d.type, d.atk, d.def, d.level, d.race, d.attribute, d.category,
            t.name, t.desc, t.str1, t.str2, t.str3, t.str4, t.str5, t.str6, t.str7, t.str8,
            t.str9, t.str10, t.str11, t.str12, t.str13, t.str14, t.str15, t.str16
       FROM datas d JOIN texts t ON t.id = d.id`,
  );
  st.setReadBigInts(true);
  for (const r of st.all()) allCards.set(Number(r.id), r);
  db.close();
}

// ---------- scripts (base y luego delta) ----------
const scriptFiles = new Map(); // nombre -> ruta (la última gana)
function indexScripts(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (['official', 'goat', 'pre-errata', 'unofficial'].includes(name)) indexScripts(p);
      continue;
    }
    if (name.endsWith('.lua')) scriptFiles.set(name, p);
  }
}
indexScripts(join(SRC, 'script'));
indexScripts(join(DELTA, 'script'));

// ---------- cierre: cartas que referencian los scripts del pool ----------
const included = new Set();
const queue = [...pool];
while (queue.length) {
  const code = queue.pop();
  if (included.has(code) || !allCards.has(code)) continue;
  included.add(code);
  const card = allCards.get(code);
  if (card.alias) queue.push(Number(card.alias));
  const sp = scriptFiles.get(`c${code}.lua`);
  if (sp) {
    for (const m of readFileSync(sp, 'utf8').matchAll(/\b(\d{5,9})\b/g)) {
      const ref = Number(m[1]);
      if (allCards.has(ref) && !included.has(ref)) queue.push(ref);
    }
  }
}
// Fichas: los scripts a veces calculan su código (p. ej. Scapegoat crea 73915051+i), así que
// no aparecen como literales. Se incluyen todas (son pocas y pequeñas).
for (const [code, card] of allCards) if (Number(card.type) & 0x4000) included.add(code);

const missingInDb = [...pool].filter((c) => !allCards.has(c));
const cards = [...included]
  .sort((a, b) => a - b)
  .map((code) => {
    const r = allCards.get(code);
    const setcode = BigInt(r.setcode);
    const setcodes = [];
    for (let i = 0n; i < 4n; i++) {
      const s = Number((setcode >> (i * 16n)) & 0xffffn);
      if (s) setcodes.push(s);
    }
    const level = Number(r.level);
    const strings = [];
    for (let i = 1; i <= 16; i++) strings.push(r[`str${i}`] ?? '');
    while (strings.length && !strings[strings.length - 1]) strings.pop();
    return {
      code,
      alias: Number(r.alias),
      setcodes,
      type: Number(r.type),
      level: level & 0xff,
      lscale: (level >> 24) & 0xff,
      rscale: (level >> 16) & 0xff,
      attribute: Number(r.attribute),
      race: Number(r.race),
      attack: Number(r.atk),
      defense: Number(r.def),
      category: Number(r.category),
      ot: Number(r.ot),
      name: r.name,
      desc: r.desc,
      strings,
      inPool: pool.has(code),
    };
  });

// Scripts: comunes (raíz de script/) + los de cada carta incluida que exista.
const scripts = {};
for (const [name, p] of scriptFiles) {
  const isCard = /^c\d+\.lua$/.test(name);
  if (!isCard || included.has(Number(name.slice(1, -4)))) scripts[name] = readFileSync(p, 'utf8');
}
const missingScripts = cards.filter((c) => c.inPool && lflist[c.code] !== 0 && !(c.type & 0x4000) && !scripts[`c${c.code}.lua`] && (c.type & 0x1) === 0);

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'cards.json'), JSON.stringify(cards));
writeFileSync(join(OUT, 'scripts.json'), JSON.stringify(scripts));
writeFileSync(join(OUT, 'lflist.json'), JSON.stringify({ name: listName, limits: lflist }));

const kb = (f) => (statSync(join(OUT, f)).size / 1024).toFixed(0);
console.log(`Lista: ${listName} (${lflistPath})`);
console.log(`Bases de datos: ${dbFiles.length} · scripts indexados: ${scriptFiles.size}`);
console.log(`Pool GOAT: ${pool.size} cartas (${Object.values(lflist).filter((l) => l === 0).length} prohibidas)`);
console.log(`Cartas en cards.json: ${cards.length} (${cards.length - cards.filter((c) => c.inPool).length} extra: fichas/alias/referencias) · ${kb('cards.json')} KB`);
console.log(`Scripts en scripts.json: ${Object.keys(scripts).length} · ${kb('scripts.json')} KB`);
if (missingInDb.length) console.log(`AVISO: ${missingInDb.length} códigos de la lista no están en las .cdb: ${missingInDb.slice(0, 10).join(', ')}`);
if (missingScripts.length) console.log(`AVISO: ${missingScripts.length} cartas no normales sin script: ${missingScripts.slice(0, 10).map((c) => `${c.code} ${c.name}`).join(', ')}`);
