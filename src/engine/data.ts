// Datos del cardpool GOAT generados por scripts/build-data.mjs.

import type { OcgCardData } from 'ocgcore-wasm';

export interface CardInfo extends OcgCardData {
  category: number;
  ot: number;
  name: string;
  desc: string;
  strings: string[];
  /** Está en la lista GOAT (si no, es una ficha/alias que necesita algún script). */
  inPool: boolean;
}

export interface GoatData {
  cards: Map<number, CardInfo>;
  scripts: Map<string, string>;
  /** Límite por código (0 = prohibida). Las cartas fuera de la lista no se pueden usar. */
  limits: Map<number, number>;
  listName: string;
}

export interface RawGoatData {
  cards: CardInfo[];
  scripts: Record<string, string>;
  lflist: { name: string; limits: Record<string, number> };
}

export function parseGoatData(raw: RawGoatData): GoatData {
  return {
    // En el JSON la raza es un número; el motor la quiere como bigint (64 bits).
    cards: new Map(raw.cards.map((c) => [c.code, { ...c, race: BigInt(c.race) }])),
    scripts: new Map(Object.entries(raw.scripts)),
    limits: new Map(Object.entries(raw.lflist.limits).map(([k, v]) => [Number(k), v])),
    listName: raw.lflist.name,
  };
}

/** Bits de tipo de carta (constant.lua). */
export const TYPE = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
  NORMAL: 0x10,
  EFFECT: 0x20,
  FUSION: 0x40,
  RITUAL: 0x80,
  SPIRIT: 0x200,
  UNION: 0x400,
  TOON: 0x400000,
  TOKEN: 0x4000,
  SYNCHRO: 0x2000,
  XYZ: 0x800000,
  LINK: 0x4000000,
} as const;

/** ¿Va al Extra Deck? (en GOAT, solo Fusiones). */
export function isExtraDeckCard(c: CardInfo): boolean {
  return (c.type & (TYPE.FUSION | TYPE.SYNCHRO | TYPE.XYZ | TYPE.LINK)) !== 0;
}
