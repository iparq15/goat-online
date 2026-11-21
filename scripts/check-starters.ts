// Comprueba que los mazos de inicio de la app son legales en GOAT.
//   node scripts/check-starters.ts
import { readFileSync } from 'node:fs';
import { parseGoatData, type RawGoatData } from '../src/engine/data.ts';
import { validateDeck } from '../src/engine/ydk.ts';
import { STARTER_DECKS } from '../src/ui/starter-decks.ts';

const data = parseGoatData({
  cards: JSON.parse(readFileSync('data/goat/cards.json', 'utf8')),
  scripts: {},
  lflist: JSON.parse(readFileSync('data/goat/lflist.json', 'utf8')),
} as RawGoatData);

let ok = true;
for (const { name, deck } of STARTER_DECKS) {
  const problems = validateDeck(deck, data);
  console.log(`${name}: ${deck.main.length} + ${deck.extra.length} cartas · ${problems.length ? problems.join(' ') : 'legal'}`);
  if (problems.length) ok = false;
}
process.exit(ok ? 0 : 1);
