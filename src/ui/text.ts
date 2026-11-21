// Textos de la interfaz: nombres de cartas, tipos, atributos, descripciones de efectos…
// Los textos del sistema vienen de EDOPro (data/goat/strings.json, en español).

import type { CardInfo, GoatData } from '../engine/data.ts';

export interface Strings {
  system: Record<number, string>;
  victory: Record<number, string>;
  counter: Record<number, string>;
}

let data: GoatData;
let strings: Strings;

export function initText(d: GoatData, s: Strings): void {
  data = d;
  strings = s;
}

export const card = (code: number): CardInfo | undefined => data.cards.get(code);

/** Nombre sin el sufijo de versión ("(GOAT)", "(Pre-Errata)"). */
export function cardName(code: number): string {
  if (!code) return 'Carta boca abajo';
  const c = data.cards.get(code);
  return c ? c.name.replace(/\s*\((GOAT|Pre-Errata)\)\s*$/i, '') : `#${code}`;
}

export const sys = (id: number): string => strings.system[id] ?? `#${id}`;

/** Texto de una descripción de efecto (aux.Stringid: código << 20 | índice). */
export function descText(desc: bigint | number): string {
  const d = BigInt(desc);
  const code = Number(d >> 20n);
  const idx = Number(d & 0xfffffn);
  if (code === 0) return sys(idx);
  const c = data.cards.get(code);
  const own = c?.strings[idx];
  if (own) return own;
  const alias = c?.alias ? data.cards.get(c.alias)?.strings[idx] : undefined;
  return alias || `Efecto de ${cardName(code)}`;
}

/** Sustituye los %ls / %d de los textos de EDOPro. */
export function fmt(text: string, ...args: (string | number)[]): string {
  let i = 0;
  return text.replace(/%(ls|d|s)/g, () => String(args[i++] ?? ''));
}

const bitIndex = (v: number) => (v > 0 ? Math.log2(v & -v) : -1);

export const ATTRIBUTE_SHORT: Record<number, string> = { 1: 'TIE', 2: 'AGU', 4: 'FUE', 8: 'VIE', 16: 'LUZ', 32: 'OSC', 64: 'DIV' };
export const attributeName = (a: number) => (a ? sys(1010 + bitIndex(a)) : '');

export function raceName(race: bigint | number): string {
  const r = BigInt(race);
  for (let i = 0n; i < 32n; i++) if ((r >> i) & 1n) return sys(1020 + Number(i));
  return '';
}

/** Línea de tipo: "Guerrero / Efecto", "Magia de Juego Rápido"… */
export function typeLine(c: CardInfo): string {
  const t = c.type;
  if (t & 0x1) {
    const parts = [raceName(c.race)];
    for (const [bit, id] of [
      [0x40, 1056],
      [0x80, 1057],
      [0x200, 1059],
      [0x400, 1060],
      [0x800, 1061],
      [0x400000, 1072],
      [0x200000, 1071],
      [0x4000, 1064],
    ] as const)
      if (t & bit) parts.push(sys(id));
    parts.push(t & 0x20 ? sys(1055) : t & 0x4000 ? '' : sys(1054));
    return parts.filter(Boolean).join(' / ');
  }
  const kind = t & 0x2 ? 'Magia' : 'Trampa';
  const sub = spellSub(t);
  return sub ? `${kind} ${sub.toLowerCase()}` : `${kind} normal`;
}

export function spellSub(t: number): string {
  if (t & 0x10000) return sys(1066);
  if (t & 0x20000) return sys(1067).replace('Contínua', 'Continua');
  if (t & 0x40000) return sys(1068);
  if (t & 0x80000) return sys(1069);
  if (t & 0x100000) return sys(1070);
  if (t & 0x80) return sys(1057);
  return '';
}

/** Icono corto del subtipo de magia/trampa para la carta pequeña. */
export function spellIcon(t: number): string {
  if (t & 0x10000) return '»';
  if (t & 0x20000) return '∞';
  if (t & 0x40000) return '+';
  if (t & 0x80000) return '▲';
  if (t & 0x100000) return '↺';
  if (t & 0x80) return '◆';
  return '';
}

export const PHASES: [number, string, string][] = [
  [1, 'RB', 'Fase de robo'],
  [2, 'ES', 'Fase de espera'],
  [4, 'P1', 'Fase principal 1'],
  [8, 'BA', 'Fase de batalla'],
  [256, 'P2', 'Fase principal 2'],
  [512, 'FN', 'Fase final'],
];

/** Fase de batalla: todos los pasos se muestran como "BA". */
export function phaseKey(phase: number): number {
  return phase >= 8 && phase <= 128 ? 8 : phase;
}

export const POSITION_NAME: Record<number, string> = {
  1: 'Ataque boca arriba',
  2: 'Ataque boca abajo',
  4: 'Defensa boca arriba',
  8: 'Defensa boca abajo',
};

export const LOCATION_NAME: Record<number, string> = {
  1: 'Mazo',
  2: 'Mano',
  4: 'Zona de monstruos',
  8: 'Zona de magias y trampas',
  16: 'Cementerio',
  32: 'Desterradas',
  64: 'Extra Deck',
  128: 'Material',
  256: 'Zona de campo',
};

export const counterName = (t: number) => strings.counter[t] ?? strings.counter[t & 0xffff] ?? 'Contador';

export const victoryText = (r: number) => strings.victory[r];

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let poolCodes: number[] | null = null;

/** Cartas del pool GOAT (para declarar un nombre), ordenadas por nombre. */
export function allPoolCodes(): number[] {
  poolCodes ??= [...data.cards.values()]
    .filter((c) => c.inPool && !(c.type & 0x4000))
    .map((c) => c.code)
    .sort((a, b) => cardName(a).localeCompare(cardName(b)));
  return poolCodes;
}
