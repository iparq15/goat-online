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
  if (deck.main.length < 40 || deck.main.length > 60) problems.push(`Main Deck has ${deck.main.length} cards (40–60).`);
  if (deck.extra.length > 15) problems.push(`Extra Deck has ${deck.extra.length} cards (max 15).`);
  if (deck.side.length > 15) problems.push(`Side Deck has ${deck.side.length} cards (max 15).`);
  // Las versiones de una misma carta (alias: GOAT, pre-errata, otro arte) cuentan juntas.
  const all = [...deck.main, ...deck.extra, ...deck.side];
  const groups = new Map<number, number>();
  for (const code of all) {
    const root = cardRoot(code, data);
    groups.set(root, (groups.get(root) ?? 0) + 1);
  }
  for (const code of new Set(all)) {
    const name = (data.cards.get(code)?.name ?? `#${code}`).replace(/\s*\((GOAT|Pre-Errata)\)\s*$/i, '');
    const limit = cardLimit(code, data);
    const n = groups.get(cardRoot(code, data)) ?? 0;
    if (limit === undefined) problems.push(`${name} is not legal in GOAT.`);
    else if (n > limit) problems.push(limit === 0 ? `${name} is forbidden.` : `${name}: ${n} copies (limit ${limit}).`);
  }
  for (const code of deck.main) {
    const c = data.cards.get(code);
    if (c && isExtraDeckCard(c)) problems.push(`${c.name} belongs in the Extra Deck.`);
  }
  for (const code of deck.extra) {
    const c = data.cards.get(code);
    if (c && !isExtraDeckCard(c)) problems.push(`${c.name} can't go in the Extra Deck.`);
  }
  return [...new Set(problems)];
}

/** Carta "raíz": todas las versiones de una carta comparten el mismo código original. */
export function cardRoot(code: number, data: GoatData): number {
  return data.cards.get(code)?.alias || code;
}

/** Límite GOAT de un código (undefined = no se puede usar). */
export function cardLimit(code: number, data: GoatData): number | undefined {
  const own = data.limits.get(code);
  if (own !== undefined) return own;
  const alias = data.cards.get(code)?.alias;
  return alias ? data.limits.get(alias) : undefined;
}

export type DeckPart = 'main' | 'extra' | 'side';

/** ¿Se puede añadir una copia de `code` a esa parte del mazo? Devuelve el motivo si no. */
export function cannotAdd(deck: Deck, code: number, part: DeckPart, data: GoatData): string | null {
  const c = data.cards.get(code);
  if (!c) return 'Unknown card.';
  const limit = cardLimit(code, data);
  if (limit === undefined) return 'Not legal in GOAT.';
  if (limit === 0) return 'Forbidden in GOAT.';
  const root = cardRoot(code, data);
  const copies = [...deck.main, ...deck.extra, ...deck.side].filter((x) => cardRoot(x, data) === root).length;
  if (copies >= limit) return `Limit reached (${limit}).`;
  if (part === 'main' && isExtraDeckCard(c)) return 'Goes in the Extra Deck.';
  if (part === 'extra' && !isExtraDeckCard(c)) return "Can't go in the Extra Deck.";
  const max = part === 'main' ? 60 : 15;
  if (deck[part].length >= max) return `${part === 'main' ? 'Main' : part === 'extra' ? 'Extra' : 'Side'} Deck is full (${max}).`;
  return null;
}

/**
 * Cambia los códigos que no están en el pool GOAT por su versión GOAT (misma carta original).
 * Así se pueden importar .ydk hechos con las cartas normales.
 */
export function normalizeDeck(deck: Deck, data: GoatData): { deck: Deck; replaced: number } {
  const byRoot = new Map<number, number>();
  for (const code of data.limits.keys()) {
    const root = cardRoot(code, data);
    // Prefiere la versión con límite más alto (la "normal" frente a una prohibida).
    const prev = byRoot.get(root);
    if (prev === undefined || (data.limits.get(code) ?? 0) > (data.limits.get(prev) ?? 0)) byRoot.set(root, code);
  }
  let replaced = 0;
  const fix = (code: number) => {
    if (cardLimit(code, data) !== undefined) return code;
    const alt = byRoot.get(cardRoot(code, data));
    if (alt !== undefined) {
      replaced++;
      return alt;
    }
    return code;
  };
  return { deck: { main: deck.main.map(fix), extra: deck.extra.map(fix), side: deck.side.map(fix) }, replaced };
}

/** Orden de un mazo: monstruos, magias, trampas; luego por nombre. */
export function sortCodes(codes: number[], data: GoatData): number[] {
  const rank = (code: number) => {
    const t = data.cards.get(code)?.type ?? 0;
    return t & 0x1 ? 0 : t & 0x2 ? 1 : 2;
  };
  const name = (code: number) => data.cards.get(code)?.name ?? '';
  return [...codes].sort((a, b) => rank(a) - rank(b) || name(a).localeCompare(name(b)) || a - b);
}
