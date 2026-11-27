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

/**
 * [nombre, principal, extra]. Las listas principales son las de goatformat.com (página indicada);
 * Water Control es una lista que pasó el usuario.
 * goatformat.com no da el Extra Deck: se usa el extra estándar de GOAT.
 */
const DECKS: [string, string, string][] = [
  // goatformat.com/chaos-turbo.html (Riclar91, campeón del Goat Format World Championship 2020)
  ['Chaos Turbo', `
1 Black Luster Soldier - Envoy of the Beginning
1 Breaker the Magical Warrior
2 Chaos Sorcerer
3 Dekoichi the Battlechanted Locomotive
3 Gravekeeper's Spy
1 Kycoo the Ghost Destroyer
2 Magician of Faith
2 Mystic Tomato
2 Night Assailant
1 Sangan
1 Sinister Serpent
3 Thunder Dragon
3 Book of Moon
1 Card Destruction
1 Delinquent Duo
1 Graceful Charity
1 Heavy Storm
2 Nobleman of Crossout
1 Pot of Greed
1 Snatch Steal
3 Raigeki Break
1 Ring of Destruction
1 Torrential Tribute
2 Trap Dustshoot`, `${CONTROL_EXTRA}`],
  // goatformat.com/chaos-control.html (Thunder Dragon Chaos Control, Dale Bellido, 2.º en el World Championship 2020)
  ['Chaos Control', `
1 Asura Priest
1 Black Luster Soldier - Envoy of the Beginning
1 Breaker the Magical Warrior
2 Chaos Sorcerer
2 Dark Mimic LV1
2 Dekoichi the Battlechanted Locomotive
2 Magician of Faith
1 Sangan
1 Sinister Serpent
3 Thunder Dragon
1 Tribe-Infecting Virus
2 Tsukuyomi
2 Book of Moon
1 Delinquent Duo
1 Graceful Charity
1 Heavy Storm
3 Metamorphosis
1 Mystical Space Typhoon
2 Nobleman of Crossout
1 Pot of Greed
2 Scapegoat
1 Snatch Steal
1 Dust Tornado
1 Mirror Force
1 Raigeki Break
1 Ring of Destruction
1 Sakuretsu Armor
1 Torrential Tribute`, `${CONTROL_EXTRA}`],
  // goatformat.com/relinquished-control.html (variante Relinquished Chaos)
  ['Relinquished Chaos', `
1 Black Luster Soldier - Envoy of the Beginning
2 Chaos Sorcerer
2 Magician of Faith
3 Manju of the Ten Thousand Hands
2 Mask of Darkness
2 Night Assailant
1 Sangan
2 Senju of the Thousand Hands
3 Thunder Dragon
2 Tsukuyomi
1 Relinquished
2 Black Illusion Ritual
1 Card Destruction
1 Delinquent Duo
1 Graceful Charity
1 Heavy Storm
1 Pot of Greed
1 Snatch Steal
2 Compulsory Evacuation Device
1 Mirror Force
2 Phoenix Wing Wind Blast
2 Raigeki Break
1 Ring of Destruction
3 Solemn Judgment`, `${CONTROL_EXTRA}`],
  // goatformat.com/warrior.html (Sean Montague, 4.º en Clash of Champions)
  ['Warrior', `
1 Black Luster Soldier - Envoy of the Beginning
3 Blade Knight
1 Breaker the Magical Warrior
1 D.D. Warrior Lady
1 Don Zaloog
1 Exiled Force
2 Kycoo the Ghost Destroyer
2 Mystic Swordsman LV2
1 Ninja Grandmaster Sasuke
1 Zombyra the Dark
2 Book of Moon
1 Delinquent Duo
1 Enemy Controller
1 Graceful Charity
1 Heavy Storm
1 Mystical Space Typhoon
2 Nobleman of Crossout
1 Pot of Greed
1 Premature Burial
2 Reinforcement of the Army
1 Snatch Steal
1 Call of the Haunted
1 Dust Tornado
1 Mirror Force
1 Ring of Destruction
2 Sakuretsu Armor
3 Solemn Judgment
3 Trap Dustshoot`, `${AGGRO_EXTRA}`],
  // goatformat.com/earth-aggro.html (Roghnach, campeón de FLC19)
  ['Earth Aggro', `
1 Breaker the Magical Warrior
3 D.D. Assailant
1 D.D. Warrior Lady
1 Exiled Force
3 Giant Rat
3 Gigantes
3 Goblin Attack Force
1 Injection Fairy Lily
1 Mystic Swordsman LV2
2 The Rock Spirit
1 Delinquent Duo
1 Graceful Charity
1 Heavy Storm
1 Mystical Space Typhoon
2 Nobleman of Crossout
1 Pot of Greed
1 Premature Burial
2 Reinforcement of the Army
2 Smashing Ground
1 Snatch Steal
1 Call of the Haunted
2 Dust Tornado
1 Mirror Force
1 Ring of Destruction
1 Torrential Tribute
2 Trap Dustshoot`, `${AGGRO_EXTRA}`],
  // goatformat.com/water-aggro.html (Water Vanilla Aggro)
  ['Water Aggro', `
2 Abyss Soldier
1 Breaker the Magical Warrior
1 Sinister Serpent
1 7 Colored Fish
3 Gagagigo
1 Giant Red Seasnake
3 Giga Gagagigo
3 Sea Serpent Warrior of Darkness
2 Terrorking Salmon
3 A Legendary Ocean
3 Dark Factory of Mass Production
1 Delinquent Duo
1 Graceful Charity
1 Heavy Storm
1 Mystical Space Typhoon
1 Nobleman of Crossout
1 Pot of Greed
1 Premature Burial
1 Snatch Steal
1 Terraforming
1 Mirror Force
1 Ring of Destruction
3 Skill Drain
3 Solemn Judgment`, `${AGGRO_EXTRA}`],
  // goatformat.com/wind-aggro.html
  ['Wind Aggro', `
1 Breaker the Magical Warrior
3 Flying Kamakiri #1
1 Garuda the Wind Spirit
1 Harpie Lady 1
1 Lady Ninja Yae
1 Sangan
3 Silpheed
3 Slate Warrior
3 Spear Dragon
1 Twin-Headed Behemoth
1 Delinquent Duo
1 Graceful Charity
1 Heavy Storm
1 Mystical Space Typhoon
2 Nobleman of Crossout
1 Pot of Greed
1 Premature Burial
3 Rising Air Current
1 Snatch Steal
1 Call of the Haunted
1 Mirror Force
1 Ring of Destruction
3 Sakuretsu Armor
3 Solemn Judgment
1 Widespread Ruin`, `${AGGRO_EXTRA}`],
  // goatformat.com (Vanilla Aggro con Skill Drain, de la captura que pasó el usuario)
  ['Vanilla Aggro', `
3 Archfiend Soldier
3 Gemini Elf
3 Insect Knight
3 Luster Dragon
3 Mad Dog of Darkness
2 Neo Bug
1 Dark Factory of Mass Production
1 Delinquent Duo
1 Graceful Charity
2 Heart of the Underdog
1 Heavy Storm
1 Mystical Space Typhoon
2 Nobleman of Crossout
2 Order to Charge
1 Pot of Greed
1 Snatch Steal
1 Mirror Force
1 Ring of Destruction
2 Sakuretsu Armor
3 Skill Drain
3 Solemn Judgment`, `${AGGRO_EXTRA}`],
  // goatformat.com/goat-control.html (Lolmarcus, 7.º en World's 2020)
  ['Goat Control', `
1 Airknight Parshath
3 Asura Priest
1 Black Luster Soldier - Envoy of the Beginning
1 Breaker the Magical Warrior
1 Chaos Sorcerer
1 D.D. Warrior Lady
1 Dark Mimic LV1
2 Dekoichi the Battlechanted Locomotive
2 Magician of Faith
1 Sangan
1 Sinister Serpent
2 Tsukuyomi
3 Book of Moon
1 Delinquent Duo
1 Graceful Charity
1 Heavy Storm
3 Metamorphosis
1 Mystical Space Typhoon
2 Nobleman of Crossout
1 Pot of Greed
2 Scapegoat
1 Snatch Steal
1 Mirror Force
1 Ring of Destruction
2 Sakuretsu Armor
1 Torrential Tribute
2 Trap Dustshoot`, `${CONTROL_EXTRA}`],
  // lista enviada por el usuario (Water Control con Mobius)
  ['Water Control', `
1 Mobius the Frost Monarch
2 Abyss Soldier
3 Mother Grizzly
2 Aqua Spirit
2 Yomi Ship
2 Maryokutai
1 Nightmare Penguin
1 Tribe-Infecting Virus
1 Sinister Serpent
1 Breaker the Magical Warrior
1 Sangan
1 Magician of Faith
2 Umiiruka
2 Metamorphosis
2 Scapegoat
1 Creature Swap
2 Nobleman of Crossout
1 Pot of Greed
1 Graceful Charity
1 Delinquent Duo
1 Snatch Steal
1 Heavy Storm
1 Premature Burial
1 Book of Moon
1 Mystical Space Typhoon
1 Mirror Force
1 Ring of Destruction
1 Call of the Haunted
2 Trap Dustshoot`, `1 Gatling Dragon
1 Twin-Headed Thunder Dragon
1 The Last Warrior from Another Planet
1 King Dragun
1 Roaring Ocean Snake
1 Dark Blade the Dragon Knight
1 Ryu Senshi
1 Reaper on the Nightmare
1 Fiend Skull Dragon
1 Dark Balter the Terrible
1 Darkfire Dragon
1 Dragoness the Wicked Knight
3 Thousand-Eyes Restrict`],
  // goatformat.com/sacred-phoenix.html
  ['Sacred Phoenix', `
3 Apprentice Magician
1 Breaker the Magical Warrior
3 D.D. Assailant
1 Hand of Nephthys
3 Kycoo the Ghost Destroyer
2 Magician of Faith
2 Old Vindictive Magician
1 Sacred Phoenix of Nephthys
1 Sangan
2 Creature Swap
1 Delinquent Duo
2 Enemy Controller
1 Graceful Charity
1 Heavy Storm
1 Mystical Space Typhoon
2 Nobleman of Crossout
1 Pot of Greed
1 Premature Burial
3 Scapegoat
1 Snatch Steal
1 Call of the Haunted
1 Mirror Force
1 Ring of Destruction
3 Solemn Judgment
1 Torrential Tribute`, `${CONTROL_EXTRA}`],
  // goatformat.com (Soul Control, de la captura que pasó el usuario)
  ['Soul Control', `
1 Breaker the Magical Warrior
2 Dark Mimic LV1
3 Dekoichi the Battlechanted Locomotive
2 Magician of Faith
3 Mobius the Frost Monarch
1 Sangan
1 Sinister Serpent
3 Thestalos the Firestorm Monarch
3 Book of Moon
1 Delinquent Duo
1 Graceful Charity
1 Heavy Storm
3 Metamorphosis
2 Nobleman of Crossout
1 Pot of Greed
3 Scapegoat
1 Snatch Steal
3 Soul Exchange
1 Mirror Force
1 Ring of Destruction
3 Sakuretsu Armor`, `${CONTROL_EXTRA}`],
  // goatformat.com/paladin-of-white-dragon.html
  ['Paladin of White Dragon', `
1 Black Luster Soldier - Envoy of the Beginning
1 Breaker the Magical Warrior
3 Dekoichi the Battlechanted Locomotive
2 Magician of Faith
3 Manju of the Ten Thousand Hands
1 Senju of the Thousand Hands
1 Sonic Bird
2 Tsukuyomi
1 Blue-Eyes White Dragon
2 Paladin of White Dragon
2 Book of Moon
1 Delinquent Duo
1 Graceful Charity
1 Heavy Storm
1 Mystical Space Typhoon
2 Nobleman of Crossout
1 Pot of Greed
1 Premature Burial
1 Snatch Steal
2 White Dragon Ritual
1 Call of the Haunted
1 Mirror Force
1 Ring of Destruction
3 Sakuretsu Armor
3 Solemn Judgment
1 Torrential Tribute`, `${CONTROL_EXTRA}`],
  // goatformat.com/fusion-gate-turbo.html (versión Dark Paladin)
  ['Dark Paladin (Fusion Gate)', `
1 Black Luster Soldier - Envoy of the Beginning
3 Buster Blader
3 King of the Swamp
3 The Dark - Hex-Sealed Fusion
3 The Light - Hex-Sealed Fusion
3 Thunder Dragon
3 Dark Magician
1 Card Destruction
3 Dimension Fusion
3 Emblem of Dragon Destroyer
3 Fusion Gate
1 Graceful Charity
1 Polymerization
1 Pot of Greed
3 Terraforming
2 Upstart Goblin
3 Royal Decree`, `3 Dark Paladin
${CONTROL_EXTRA}`],
  // goatformat.com/zombie.html (Delinkquent, FLC17)
  ['Zombies', `
3 Berserk Gorilla
3 Giant Rat
3 Kycoo the Ghost Destroyer
3 Pyramid Turtle
3 Ryu Kokki
1 Breaker the Magical Warrior
1 Exiled Force
1 Injection Fairy Lily
1 Tribe-Infecting Virus
1 Vampire Lord
3 Book of Life
3 Tribute to the Doomed
2 Creature Swap
2 Nobleman of Crossout
1 Graceful Charity
1 Heavy Storm
1 Mystical Space Typhoon
1 Pot of Greed
1 Premature Burial
1 Snatch Steal
3 Royal Decree
1 Call of the Haunted`, `${AGGRO_EXTRA}`],
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

const lower = new Map([...byName.keys()].map((k) => [k.toLowerCase(), k]));

function parse(list: string): number[] {
  const out: number[] = [];
  for (const line of list.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = /^(\d+)\s+(.+)$/.exec(line);
    if (!m) throw new Error(`Línea mal: ${line}`);
    const code = byName.get(m[2]!) ?? byName.get(lower.get(m[2]!.toLowerCase()) ?? '');
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
