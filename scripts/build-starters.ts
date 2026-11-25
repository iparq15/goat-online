// Genera src/ui/starter-decks.ts a partir de listas por nombre (versiones estándar de los
// arquetipos de GOAT) y comprueba que cada mazo es legal en la lista de abril de 2005.
//   node scripts/build-starters.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { parseGoatData, type RawGoatData } from '../src/engine/data.ts';
import { normalizeDeck, validateDeck, type Deck } from '../src/engine/ydk.ts';

const STAPLE_SPELLS = `1 Pot of Greed
1 Graceful Charity
1 Delinquent Duo
1 Snatch Steal
1 Heavy Storm
1 Mystical Space Typhoon
1 Premature Burial`;
const STAPLE_TRAPS = `1 Mirror Force
1 Call of the Haunted
1 Torrential Tribute
1 Ring of Destruction`;
const CONTROL_EXTRA = `1 Thousand-Eyes Restrict
1 Fiend Skull Dragon
1 Gatling Dragon
1 Dark Balter the Terrible
1 Reaper on the Nightmare
1 Ryu Senshi
1 Dark Flare Knight
1 St. Joan
1 Sanwitch
1 Ojama King`;
const AGGRO_EXTRA = `1 Thousand-Eyes Restrict
1 Fiend Skull Dragon
1 Gatling Dragon
1 Ryu Senshi
1 Dark Balter the Terrible`;

/** [nombre, principal, extra] */
const DECKS: [string, string, string][] = [
  ['Chaos Turbo', `
1 Black Luster Soldier - Envoy of the Beginning
2 Chaos Sorcerer
1 Breaker the Magical Warrior
1 Tribe-Infecting Virus
1 Sangan
1 Jinzo
1 Sinister Serpent
1 D.D. Warrior Lady
2 Thunder Dragon
2 Magical Merchant
1 Exiled Force
1 Mystic Swordsman LV2
${STAPLE_SPELLS}
1 Card Destruction
2 Upstart Goblin
2 Nobleman of Crossout
1 Swords of Revealing Light
1 Smashing Ground
1 Lightning Vortex
1 Enemy Controller
${STAPLE_TRAPS}
1 Reckless Greed
2 Sakuretsu Armor
1 Dust Tornado
1 Ceasefire`, AGGRO_EXTRA],
  ['Chaos Control', `
1 Black Luster Soldier - Envoy of the Beginning
2 Chaos Sorcerer
1 Breaker the Magical Warrior
1 Tribe-Infecting Virus
1 Sangan
1 Jinzo
1 Morphing Jar
1 Sinister Serpent
1 Magician of Faith
1 D.D. Warrior Lady
2 Airknight Parshath
1 Tsukuyomi
1 Spirit Reaper
1 Exiled Force
${STAPLE_SPELLS}
1 Swords of Revealing Light
2 Scapegoat
1 Metamorphosis
2 Nobleman of Crossout
2 Book of Moon
${STAPLE_TRAPS}
2 Sakuretsu Armor
1 Dust Tornado
1 Ceasefire
1 Solemn Judgment`, CONTROL_EXTRA],
  ['Chaos Ritual', `
2 Senju of the Thousand Hands
2 Manju of the Ten Thousand Hands
2 Sonic Bird
2 Black Luster Soldier
1 Chaos Sorcerer
1 Black Luster Soldier - Envoy of the Beginning
1 Breaker the Magical Warrior
1 Tribe-Infecting Virus
1 Sangan
1 Jinzo
1 Sinister Serpent
1 D.D. Warrior Lady
1 Magician of Faith
2 Black Luster Ritual
${STAPLE_SPELLS}
1 Swords of Revealing Light
2 Nobleman of Crossout
1 Book of Moon
1 Scapegoat
${STAPLE_TRAPS}
2 Sakuretsu Armor
1 Dust Tornado
1 Ceasefire
1 Solemn Judgment`, AGGRO_EXTRA],
  ['Warrior', `
1 Exiled Force
1 D.D. Warrior Lady
2 D.D. Assailant
2 Blade Knight
2 Command Knight
2 Marauding Captain
1 Mataza the Zapper
1 Mystic Swordsman LV2
1 Breaker the Magical Warrior
1 Sangan
1 Tribe-Infecting Virus
1 Jinzo
2 Reinforcement of the Army
${STAPLE_SPELLS}
2 Nobleman of Crossout
1 Swords of Revealing Light
1 Smashing Ground
1 Lightning Vortex
${STAPLE_TRAPS}
2 Sakuretsu Armor
1 Dust Tornado
2 Bottomless Trap Hole
1 Ceasefire`, AGGRO_EXTRA],
  ['Earth Aggro', `
3 Giant Rat
2 Berserk Gorilla
2 Goblin Attack Force
1 Exiled Force
2 D.D. Assailant
1 Hyper Hammerhead
2 Granmarg the Rock Monarch
1 Gigantes
1 Breaker the Magical Warrior
1 Sangan
${STAPLE_SPELLS}
2 Nobleman of Crossout
2 Smashing Ground
1 Enemy Controller
1 Lightning Vortex
1 Rush Recklessly
${STAPLE_TRAPS}
2 Sakuretsu Armor
1 Dust Tornado
2 Bottomless Trap Hole
1 Ceasefire`, AGGRO_EXTRA],
  ['Water Aggro', `
3 Mother Grizzly
1 Penguin Soldier
2 Abyss Soldier
2 Mobius the Frost Monarch
2 Fenrir
1 Tribe-Infecting Virus
1 Sinister Serpent
1 Levia-Dragon - Daedalus
1 Sangan
1 Breaker the Magical Warrior
${STAPLE_SPELLS}
2 Nobleman of Crossout
1 Smashing Ground
1 Enemy Controller
1 Lightning Vortex
1 Rush Recklessly
1 Creature Swap
${STAPLE_TRAPS}
2 Sakuretsu Armor
1 Dust Tornado
2 Bottomless Trap Hole
1 Ceasefire
1 Waboku`, AGGRO_EXTRA],
  ['Wind Aggro', `
2 Armed Dragon LV3
2 Armed Dragon LV5
1 Armed Dragon LV7
2 Spear Dragon
1 Twin-Headed Behemoth
2 Slate Warrior
1 Sasuke Samurai
1 Sangan
1 Breaker the Magical Warrior
1 Jinzo
1 Tribe-Infecting Virus
2 Level Up!
${STAPLE_SPELLS}
2 Nobleman of Crossout
1 Smashing Ground
1 Enemy Controller
1 Rush Recklessly
${STAPLE_TRAPS}
2 Sakuretsu Armor
1 Dust Tornado
2 Bottomless Trap Hole
1 Ceasefire
1 Waboku`, AGGRO_EXTRA],
  ['Goat Control', `
1 Black Luster Soldier - Envoy of the Beginning
1 Breaker the Magical Warrior
1 Tribe-Infecting Virus
1 Sangan
1 Jinzo
1 Morphing Jar
1 Sinister Serpent
1 Magician of Faith
1 D.D. Warrior Lady
2 Airknight Parshath
2 Tsukuyomi
1 Spirit Reaper
1 Exiled Force
${STAPLE_SPELLS}
1 Swords of Revealing Light
2 Scapegoat
1 Metamorphosis
2 Nobleman of Crossout
2 Book of Moon
${STAPLE_TRAPS}
2 Sakuretsu Armor
1 Dust Tornado
1 Ceasefire
1 Solemn Judgment
1 Last Turn`, CONTROL_EXTRA],
  ['Water Control', `
2 Mobius the Frost Monarch
1 Penguin Soldier
2 Abyss Soldier
2 Mother Grizzly
1 Tribe-Infecting Virus
1 Sinister Serpent
1 Sangan
1 Morphing Jar
1 Breaker the Magical Warrior
1 Jinzo
1 Spirit Reaper
1 D.D. Warrior Lady
${STAPLE_SPELLS}
1 Swords of Revealing Light
2 Scapegoat
2 Book of Moon
2 Nobleman of Crossout
1 Creature Swap
${STAPLE_TRAPS}
2 Sakuretsu Armor
1 Dust Tornado
1 Ceasefire
1 Solemn Judgment
1 Royal Decree`, CONTROL_EXTRA],
  ['Phoenix Control', `
1 Sacred Phoenix of Nephthys
2 Hand of Nephthys
1 Black Luster Soldier - Envoy of the Beginning
1 Breaker the Magical Warrior
1 Tribe-Infecting Virus
1 Sangan
1 Jinzo
1 Morphing Jar
1 Sinister Serpent
1 Magician of Faith
1 D.D. Warrior Lady
1 Airknight Parshath
1 Tsukuyomi
1 Spirit Reaper
${STAPLE_SPELLS}
1 Swords of Revealing Light
2 Scapegoat
2 Book of Moon
2 Nobleman of Crossout
1 Card Destruction
${STAPLE_TRAPS}
2 Sakuretsu Armor
1 Dust Tornado
1 Ceasefire
1 Solemn Judgment
1 Last Turn`, CONTROL_EXTRA],
  ['Soul Control', `
2 Zaborg the Thunder Monarch
1 Thestalos the Firestorm Monarch
1 Mobius the Frost Monarch
1 Black Luster Soldier - Envoy of the Beginning
1 Breaker the Magical Warrior
1 Tribe-Infecting Virus
1 Sangan
1 Jinzo
1 Morphing Jar
1 Sinister Serpent
1 Magician of Faith
1 Spirit Reaper
1 D.D. Warrior Lady
1 Tsukuyomi
2 Soul Exchange
1 Brain Control
${STAPLE_SPELLS}
2 Scapegoat
1 Book of Moon
2 Nobleman of Crossout
${STAPLE_TRAPS}
2 Sakuretsu Armor
1 Dust Tornado
1 Ceasefire
1 Solemn Judgment
1 Last Turn`, CONTROL_EXTRA],
];

const raw: RawGoatData = {
  cards: JSON.parse(readFileSync('data/goat/cards.json', 'utf8')),
  scripts: {},
  lflist: JSON.parse(readFileSync('data/goat/lflist.json', 'utf8')),
} as RawGoatData;
const data = parseGoatData(raw);
const byName = new Map<string, number>();
for (const c of raw.cards as { code: number; alias: number; name: string; inPool: boolean }[]) {
  if (!c.inPool) continue;
  const n = c.name.replace(/\s*\((GOAT|Pre-Errata)\)\s*$/i, '');
  // Preferimos la versión "(GOAT)" si existe.
  if (!byName.has(n) || /\(GOAT\)$/.test(c.name)) byName.set(n, c.code);
}

function parse(list: string): number[] {
  const out: number[] = [];
  for (const line of list.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = /^(\d+)\s+(.+)$/.exec(line);
    if (!m) throw new Error(`Línea mal: ${line}`);
    const code = byName.get(m[2]!);
    if (!code) throw new Error(`No está en el pool: ${m[2]}`);
    for (let i = 0; i < Number(m[1]); i++) out.push(code);
  }
  return out;
}

let ok = true;
const decks = DECKS.map(([name, main, extra]) => {
  const deck: Deck = normalizeDeck({ main: parse(main), extra: parse(extra), side: [] }, data).deck;
  const problems = validateDeck(deck, data);
  console.log(`${name}: ${deck.main.length} + ${deck.extra.length} · ${problems.length ? problems.join(' ') : 'legal'}`);
  if (problems.length) ok = false;
  return { name, deck };
});
if (!ok) process.exit(1);

const body = decks
  .map(({ name, deck }) => `  {\n    name: ${JSON.stringify(name)},\n    deck: {\n      main: [${deck.main.join(', ')}],\n      extra: [${deck.extra.join(', ')}],\n      side: [],\n    },\n  },`)
  .join('\n');
writeFileSync(
  'src/ui/starter-decks.ts',
  `// Mazos de inicio: versiones estándar de los arquetipos de GOAT (abril de 2005).
// GENERADO por scripts/build-starters.ts (las listas por nombre están allí): no editar a mano.

import type { Deck } from '../engine/ydk.ts';

export interface NamedDeck {
  name: string;
  deck: Deck;
}

// prettier-ignore
export const STARTER_DECKS: NamedDeck[] = [
${body}
];
`,
);
console.log('Escrito src/ui/starter-decks.ts');
