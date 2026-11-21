// Mazos en formato .ydk (EDOPro/YGOPro) y validación GOAT.

import { isExtraDeckCard, type GoatData } from './data.ts';

export interface Deck {
  main: number[];
  extra: number[];
  side: number[];
}

export function parseYdk(text: string): Deck {
  const deck: Deck = { main: [], extra: [], side: [] };
  let part: keyof Deck = 'main';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '#main') part = 'main';
    else if (line === '#extra') part = 'extra';
    else if (line === '!side') part = 'side';
    else if (/^\d+$/.test(line)) deck[part].push(Number(line));
  }
  return deck;
}

export function toYdk(deck: Deck): string {
  return ['#created by GOAT Online', '#main', ...deck.main, '#extra', ...deck.extra, '!side', ...deck.side, ''].join('\n');
}

/** Problemas de legalidad GOAT del mazo (vacío = legal). */
export function validateDeck(deck: Deck, data: GoatData): string[] {
  const problems: string[] = [];
  if (deck.main.length < 40 || deck.main.length > 60) problems.push(`El Main Deck tiene ${deck.main.length} cartas (40–60).`);
  if (deck.extra.length > 15) problems.push(`El Extra Deck tiene ${deck.extra.length} cartas (máx. 15).`);
  if (deck.side.length > 15) problems.push(`El Side Deck tiene ${deck.side.length} cartas (máx. 15).`);
  const counts = new Map<number, number>();
  for (const code of [...deck.main, ...deck.extra, ...deck.side]) {
    const card = data.cards.get(code);
    // Las copias con otro código (alias) cuentan como la misma carta.
    const key = card?.alias && data.limits.has(card.alias) ? card.alias : code;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [code, n] of counts) {
    const name = data.cards.get(code)?.name ?? `#${code}`;
    const limit = data.limits.get(code);
    if (limit === undefined) problems.push(`${name} no es legal en GOAT.`);
    else if (n > limit) problems.push(`${name}: ${n} copias (límite ${limit}).`);
  }
  for (const code of deck.main) {
    const c = data.cards.get(code);
    if (c && isExtraDeckCard(c)) problems.push(`${c.name} va en el Extra Deck.`);
  }
  for (const code of deck.extra) {
    const c = data.cards.get(code);
    if (c && !isExtraDeckCard(c)) problems.push(`${c.name} no puede ir en el Extra Deck.`);
  }
  return [...new Set(problems)];
}
