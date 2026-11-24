// Motivos por nombre: para las cartas sin icono propio, una palabra clave del nombre elige un
// motivo pixel (dragón, espada, calavera…) coloreado con el atributo de la carta. Las reglas van
// de lo más específico a lo más general; gana la primera que coincide. Si no hay palabra clave:
// el tipo del monstruo, o lo que hace la magia/trampa (destruir, robar, buscar…).

import { CARD_SPRITES as CS } from './card-sprites.ts';
import { NEW_MOTIFS as N } from './motif-sprites.ts';
import { RACE_MOTIF, RACE_MOTIFS as R } from './race-motifs.ts';
import { re, type Sprite } from './sprite-tools.ts';
import { SPRITES } from './sprites.ts';

const w = (words: string): RegExp => new RegExp(`\\b(?:${words})`, 'i');

export const MOTIF_RULES: [RegExp, string][] = [
  // Nombres compuestos que engañarían a las reglas generales.
  [w('gravekeeper'), 'hood'],
  [w('archfiend|fiend|demon|devil|imp\\b|daemon|kishin|maju'), 'demon'],
  [w('toon'), 'toon'],
  [w('ojama'), 'ojama'],
  [w('exodia|forbidden one'), 'sealed'],
  [w('amazoness'), 'amazon'],
  [w('harpie|harpy'), 'harpie'],
  [w('scorpion'), 'scorpion'],
  [w('jinzo|cyber|robot|mech|machine|android|gear|metal|steel|iron|mecha|cannon soldier|launcher'), 'gear'],
  [w('cannon|gun|tank|missile|rocket|shot\\b|bazooka|blaster'), 'cannon'],
  [w('dragon|wyvern|drake|wyrm|ryu\\b|ryu-'), 'dragon'],
  [w('dinosaur|saurus|\\brex\\b|raptor|dino'), 'dino'],
  [w('serpent|snake|cobra|naga|viper|lizard|reptile|gator|crocodile|alligator'), 'snake'],
  [w('turtle|tortoise'), 'turtle'],
  [w('penguin'), 'penguin'],
  [w('frog|toad|frog'), 'frog'],
  [w('fish|shark|whale|mermaid|merman|octopus|squid|kraken|crab|eel|ocean|sea\\b|aqua'), 'fish'],
  [w('bird|crow|raven|eagle|hawk|falcon|phoenix|owl|condor|griffin|gryphon|winged|wing\\b|feather'), 'bird'],
  [w('insect|ladybug|bug\\b|bugs|moth|beetle|worm|ant\\b|mantis|locust|scarab|spider|bee\\b|hornet|caterpillar|cocoon|larva|parasite|cockroach'), 'bug'],
  [w('vampire|bat\\b|bats'), 'bat'],
  [w('wolf|dog\\b|hound|jackal|fox|cerberus'), 'wolf'],
  [w('cat\\b|cats|tiger|lion|panther|leopard|neko|lynx'), 'cat'],
  [w('horse|unicorn|pegasus|gaia|centaur'), 'horse'],
  [w('ape|monkey|mokey|gorilla|baboon'), 'ape'],
  [w('rabbit|bunny|mouse|rat\\b|squirrel|momonga|panda|bear|boar|pig\\b|cow|bull\\b|ox\\b|goat|sheep'), 'critter'],
  [w('beast'), 'beastface'],
  [w('skull|bone|zombie|mummy|ghoul|skeleton|lich|undead|corpse|pumpking'), 'skull'],
  [w('ghost|spirit|soul|phantom|specter|spectre|wraith|haunt|poltergeist'), 'ghost'],
  [w('coffin|sarcophagus|tomb|grave\\b|graveyard|burial|cemetery'), 'tomb'],
  [w('goblin|ogre|orc\\b|troll|gremlin|oni\\b'), 'goblin'],
  [w('golem|giant|statue|stone|rock\\b|boulder|titan|colossus|guardian'), 'golem'],
  [w('fairy|angel|maiden|cupid|valkyrie|goddess|saint|seraph|cherub'), 'angel'],
  [w('elf\\b|elves'), 'elf'],
  [w('witch|magician|mage\\b|sorcerer|sorceress|wizard|sage\\b|charmer|enchant|warlock|shaman|priest|priestess|monk\\b'), 'wizard'],
  [w('ninja|assassin|assailant|thief|bandit|rogue'), 'ninja'],
  [w('samurai|shogun|sasuke'), 'samurai'],
  [w('archer|hunter|bow\\b|arrow'), 'bow'],
  [w('king|queen|lord|ruler|emperor|empress|monarch|royal|prince|princess|throne|crown|majesty'), 'crown'],
  [w('knight|paladin|cavalier'), 'knight'],
  [w('swordsman|swordmaster|sword|blade|saber|sabre|katana|slash'), 'sword'],
  [w('axe'), 'axe'],
  [w('spear|lance|javelin|trident|halberd|needle|thorn|spike'), 'spear'],
  [w('soldier|warrior|fighter|guard\\b|guards|gladiator|mercenary|commander|captain|hero|champion|brave|berserker|marauding'), 'helmet'],
  [w('shield|wall\\b|barrier|protector|defender|armor|armour|fortress'), 'shield'],
  [w('clown|jester|joker|comedian|puppet|doll|marionette'), 'clown'],
  [w('mask'), 'mask'],
  [w('eyes?\\b|vision|watcher'), 'eye'],
  [w('mind|brain|psychic|telepath'), 'brain'],
  [w('jar\\b|pot\\b|vase|urn'), 'jar'],
  [w('flame|fire|burn|inferno|blaze|molten|magma|lava|volcan|heat|darkfire|pyro|ember|solar'), 'flame'],
  [w('ice\\b|frost|snow|freez|blizzard|glacier|cold\\b'), 'ice'],
  [w('thunder|lightning|electric|zap|volt|spark|plasma|raigeki'), 'bolt'],
  [w('wind|tornado|storm|cyclone|typhoon|hurricane|gust|tempest|whirlwind|sky\\b'), 'wind'],
  [w('water|wave|tide|rain|flood|tsunami|umi'), 'wave'],
  [w('flower|plant|tree|forest|rose|vine|seed|bloom|lotus|wood|leaf|petal|cactus|mushroom'), 'plant'],
  [w('moon|lunar|night\\b|nightmare'), 'moon'],
  [w('sun\\b|light\\b|shining|holy|radiant|dawn|ray\\b'), 'sun'],
  [w('star\\b|stars|meteor|comet|cosmic|galaxy'), 'star'],
  [w('chaos|dark\\b|darkness|shadow|black hole|void|abyss|evil|wicked|curse|cursed|hex\\b'), 'darkorb'],
  [w('dimension|portal|gate\\b|warp|d\\.d\\.|different'), 'portal'],
  [w('chain|seal\\b|sealed|bind|binding|shackle|prison|jail|lock'), 'chain'],
  [w('hole|pit\\b|trap\\b|pitfall'), 'hole'],
  [w('mirror|reflect'), 'mirror'],
  [w('dice'), 'dice'],
  [w('coin|gold\\b|treasure|money|greed|riches|jewel|gem|crystal|diamond'), 'gem'],
  [w('book|tome|scroll|contract|decree|message|letter|order|law|rule'), 'scroll'],
  [w('heart|life\\b|heal|recover|cure|potion|blessing'), 'heart'],
  [w('poison|venom|toxic|acid|virus|plague|disease'), 'poison'],
  [w('time\\b|clock|hour|turn\\b|countdown|timer'), 'hourglass'],
  [w('castle|tower|temple|labyrinth|palace|city|shrine|pyramid|house|fortress'), 'castle'],
  [w('blast|burst|explo|bomb|destruction|destruct|nuke|annihilat|ruin|crush|smash|break'), 'boom'],
  [w('magnet|magnetic'), 'magnet'],
  [w('music|harp|song|melody|bell'), 'note'],
  [w('ship|boat|plane|jet|train|car\\b|vehicle|cart|airship'), 'vehicle'],
  [w('energy|power|force\\b|strength|charge|level|limit|boost|mega|ultimate|super'), 'power'],
  [w('fusion|polymer|unite|union|combine|merge'), 'swirl'],
  [w('sphinx|pharaoh|anubis|desert|sand\\b|oasis|apophis|sarcophag|hieroglyph'), 'pyramid'],
  [w('slime|germ|germs|ameba|amoeba|jelly|jellyfish|jam\\b|ooze|mucus|yolk|blob'), 'blob'],
  [w('ritual'), 'candle'],
  [w('medicine|pill|stim|rest\\b|rebirth|restor'), 'heart'],
  [w('koala|kangaroo|wombat|mammoth|elephant|elefantis|steer|lamb|lambs|animal|animals|duck|peacock|chicken|niwatori'), 'critter'],
  [w('spell|spellbook|magic\\b|magical|mystic|mystical|wisdom'), 'spellbook'],
  [w('attack|strike|blow|punch|fist|assault|counter'), 'boom'],
  [w('card|draw|hand\\b|cards'), 'cards'],
  [w('man\\b|lady|girl|boy|woman|master|lord|elder|old\\b|kid|baby|child'), 'person'],
];

/** Motivo por nombre de la carta, o null si ninguna palabra clave coincide. */
export function motifFor(name: string): string | null {
  for (const [re, m] of MOTIF_RULES) if (re.test(name)) return m;
  return null;
}

/** Dibujos de cada motivo. */
// prettier-ignore
export const MOTIFS: Record<string, Sprite> = {
  ...N,
  hood: re(CS[24317029]!, { p: 'a', y: 'c' }),
  demon: SPRITES.monster!, // criatura de cuernos de hueso (propia)
  ojama: CS[29843091]!,
  harpie: R.wingedbeast!,
  gear: R.machine!,
  cannon: re(CS[38992735]!, { g: 'a', w: 'c' }),
  dragon: R.dragon!,
  dino: R.dinosaur!,
  snake: R.reptile!,
  penguin: CS[93920745]!,
  fish: R.fish!,
  bird: R.wingedbeast!,
  bug: R.insect!,
  bat: re(CS[53839837]!, { p: 'a' }),
  ape: re(CS[39168895]!, { n: 'a' }),
  beastface: R.beast!,
  skull: R.zombie!,
  ghost: re(CS[97077563]!, { w: 'c' }),
  goblin: re(CS[70368879]!, { e: 'a' }),
  golem: R.rock!,
  angel: R.fairy!,
  elf: re(CS[21417692]!, { p: 'a', d: 'b' }),
  wizard: R.spellcaster!,
  ninja: re(CS[41006930]!, { p: 'a' }),
  samurai: re(CS[16222645]!, { u: 'a' }),
  knight: re(CS[39507162]!, { y: 'a' }),
  axe: CS[40619825]!,
  spear: CS[96355986]!,
  helmet: R.warrior!,
  shield: re(CS[65240384]!, { g: 'a', d: 'b', w: 'c' }),
  mask: re(CS[28933734]!, { p: 'a' }),
  brain: CS[87910978]!,
  jar: re(CS[33508719]!, { n: 'a' }),
  flame: R.pyro!,
  bolt: R.thunder!,
  wind: CS[5318639]!,
  wave: R.aqua!,
  plant: R.plant!,
  chain: re(CS[29267084]!, { p: 'a' }),
  hole: CS[4206964]!,
  mirror: CS[44095762]!,
  scroll: CS[51452091]!,
  poison: re(CS[34206604]!, { e: 'a' }),
  hourglass: CS[28566710]!,
  boom: CS[61127349]!,
  power: CS[22046459]!,
  swirl: CS[24094653]!,
  candle: SPRITES.ritual!,
  spellbook: SPRITES.spell!,
};

/** Motivo según lo que hace una magia/trampa (bits de categoría de la base de datos de cartas). */
function categoryMotif(category: number): string | null {
  const has = (bit: number): boolean => Math.floor(category / bit) % 2 === 1;
  if (has(0x10000)) return 'negate';
  if (has(0x100000)) return 'pillar';
  if (has(0x1) || has(0x2)) return 'boom';
  if (has(0x40000)) return 'flame';
  if (has(0x80000)) return 'heart';
  if (has(0x100)) return 'cards';
  if (has(0x200)) return 'search';
  if (has(0x40000000)) return 'brain';
  if (has(0x20000000)) return 'dice';
  if (has(0x1000)) return 'power';
  return null;
}

/**
 * Icono de una carta sin dibujo propio: motivo por nombre; si no, por tipo de monstruo o por lo
 * que hace la magia/trampa. null = usar el logo genérico de su clase.
 */
export function motifSprite(name: string, isMonster: boolean, race: number, category: number): Sprite | null {
  const byName = motifFor(name);
  if (byName && MOTIFS[byName]) return MOTIFS[byName]!;
  if (isMonster) {
    const r = RACE_MOTIF[race & -race];
    if (r === 'fiend') return MOTIFS.demon!;
    return r ? (R[r] ?? null) : null;
  }
  const byEffect = categoryMotif(category);
  return byEffect ? (MOTIFS[byEffect] ?? null) : null;
}
