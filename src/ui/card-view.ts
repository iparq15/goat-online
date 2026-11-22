// Cartas sin ilustración oficial: marco pixel propio + un icono pixel original (propio de la carta
// en las más jugadas, src/ui/card-sprites.ts; si no, según su tipo, src/ui/sprites.ts) sobre un
// emblema generado a partir del código de la carta.

import { TYPE, type CardInfo } from '../engine/data.ts';
import { RACE_SPRITE, SPRITES } from './sprites.ts';
import { CARD_SPRITES } from './card-sprites.ts';
import { ATTRIBUTE_SHORT, card, cardName, esc, spellIcon, typeLine, attributeName, POSITION_NAME } from './text.ts';


export function frameKind(c: CardInfo | undefined): string {
  if (!c) return 'back';
  const t = c.type;
  if (t & TYPE.TOKEN) return 'token';
  if (t & TYPE.SPELL) return 'spell';
  if (t & TYPE.TRAP) return 'trap';
  if (t & TYPE.FUSION) return 'fusion';
  if (t & TYPE.RITUAL) return 'ritual';
  if (t & TYPE.EFFECT) return 'effect';
  return 'normal';
}

function hash(n: number): () => number {
  let a = (n ^ 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sigils = new Map<number, string>();

/** Colores [principal, sombra, luz] del icono según atributo o tipo de carta. */
const ATTR_TRIPLE: Record<number, [string, string, string]> = {
  1: ['#c08a4c', '#6b4421', '#e8c08a'],
  2: ['#4aa3ff', '#1d4c8f', '#a8d8ff'],
  4: ['#ff6a3d', '#8f2414', '#ffb08f'],
  8: ['#5fd36b', '#1f6b2c', '#b5f2b9'],
  16: ['#ffd84a', '#a07a12', '#fff3b0'],
  32: ['#a46be0', '#4a2380', '#d6b5ff'],
  64: ['#ffb347', '#8f5a10', '#ffe0a8'],
};
const FIXED: Record<string, string> = {
  k: '#120c22', w: '#fff4dc', y: '#ffd24a', g: '#a9a9c4', r: '#ff3d55',
  e: '#5fd36b', u: '#4aa3ff', p: '#a46be0', n: '#8a5a2e', s: '#f2c29a', d: '#3a3350', o: '#ff8a2a',
};

/** Qué icono lleva la carta: tipo de monstruo o subtipo de magia/trampa. */
function spriteFor(c: CardInfo | undefined): string {
  if (!c) return 'token';
  const t = c.type;
  if (t & TYPE.TOKEN) return 'token';
  if (t & TYPE.SPELL) {
    if (t & 0x10000) return 'quickplay';
    if (t & 0x20000) return 'continuous';
    if (t & 0x40000) return 'equip';
    if (t & 0x80000) return 'field';
    if (t & 0x80) return 'ritual';
    return 'spell';
  }
  if (t & TYPE.TRAP) {
    if (t & 0x20000) return 'trapcontinuous';
    if (t & 0x100000) return 'counter';
    return 'trap';
  }
  const race = Number(c.race);
  return RACE_SPRITE[race & -race] ?? 'token';
}

/**
 * Ilustración pixel de la carta (data URL, 16x16): icono de su tipo con los colores de su
 * atributo, sobre un emblema tenue generado a partir del código (distinto en cada carta).
 */
export function sigilUrl(code: number): string {
  const cached = sigils.get(code);
  if (cached) return cached;
  const c = card(code);
  const rnd = hash(code);
  const kind = frameKind(c);
  const [a, b, l] =
    kind === 'spell'
      ? (['#3fd6ac', '#14584a', '#b8f5e3'] as const)
      : kind === 'trap'
        ? (['#ff6fbf', '#6b1a4e', '#ffc2e6'] as const)
        : kind === 'token'
          ? (['#c9c9d6', '#5b5b66', '#f0f0f6'] as const)
          : (ATTR_TRIPLE[c?.attribute ?? 0] ?? (['#cccccc', '#555555', '#eeeeee'] as const));
  const own = CARD_SPRITES[c?.alias || code];
  const N = 16;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#120c22';
  g.fillRect(0, 0, N, N);
  // Fondo: emblema simétrico tenue, único para cada carta.
  g.globalAlpha = own ? 0.14 : 0.28;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 4; x++) {
      if (rnd() > 0.5) continue;
      g.fillStyle = rnd() < 0.5 ? b : a;
      for (const xx of [x, 7 - x]) g.fillRect(xx * 2, y * 2, 2, 2);
    }
  }
  g.globalAlpha = 1;
  const colors: Record<string, string> = { ...FIXED, a, b, c: l };
  const rows = own ?? SPRITES[spriteFor(c)] ?? [];
  rows.forEach((row, y) => {
    for (let x = 0; x < Math.min(16, row.length); x++) {
      const ch = row[x];
      if (ch === '.') continue;
      g.fillStyle = colors[ch] ?? a;
      g.fillRect(x, y, 1, 1);
    }
  });
  const url = cv.toDataURL();
  sigils.set(code, url);
  return url;
}

let backCache = '';

/** Dorso de las cartas (diseño propio: rombos sobre añil con un núcleo ámbar). */
export function backUrl(): string {
  if (backCache) return backCache;
  const W = 14;
  const H = 20;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#2a1d5c';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#3b2a7a';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x + y) % 4 === 0 || (x - y + 40) % 4 === 0) g.fillRect(x, y, 1, 1);
  const cx = W / 2;
  const cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x + 0.5 - cx) + Math.abs(y + 0.5 - cy) * 0.8;
      if (d < 2.2) g.fillStyle = '#ffd36b';
      else if (d < 3.4) g.fillStyle = '#d9822b';
      else if (d < 4.2) g.fillStyle = '#120c22';
      else continue;
      g.fillRect(x, y, 1, 1);
    }
  }
  backCache = cv.toDataURL();
  return backCache;
}

export interface MiniOpts {
  /** Posición (para marcar las colocadas boca abajo). */
  position?: number;
  /** Monstruo en el campo: se gira si está en defensa. */
  monster?: boolean;
  attack?: number;
  defense?: number;
  /** Clases extra. */
  cls?: string;
  /** Atributo data-* para la interacción. */
  data?: string;
}

/** Carta pequeña (campo, mano, listas). code 0 = dorso. */
export function miniCard(code: number, o: MiniOpts = {}): string {
  const pos = o.position ?? 1;
  const def = !!o.monster && (pos & 0xc) !== 0;
  const facedown = (pos & 0xa) !== 0;
  const cls = ['card', def ? 'def' : '', o.cls ?? ''];
  const data = o.data ?? '';
  if (!code) return `<div class="${cls.join(' ')} k-back" ${data} style="--img:url(${backUrl()})"></div>`;
  const c = card(code);
  const kind = frameKind(c);
  cls.push(`k-${kind}`);
  if (facedown) cls.push('set');
  let bottom = '';
  let badge = '';
  if (c && c.type & TYPE.MONSTER) {
    const atk = o.attack ?? c.attack;
    const dfn = o.defense ?? c.defense;
    const atkCls = o.attack !== undefined && o.attack !== c.attack ? (o.attack > c.attack ? 'up' : 'down') : '';
    const defCls = o.defense !== undefined && o.defense !== c.defense ? (o.defense > c.defense ? 'up' : 'down') : '';
    bottom = `<div class="cs"><span class="${atkCls}">${fmtStat(atk)}</span><span class="${defCls}">${fmtStat(dfn)}</span></div>`;
    badge = `<span class="attr a${c.attribute}">${ATTRIBUTE_SHORT[c.attribute] ?? ''}</span>`;
  } else if (c) {
    bottom = `<div class="cs st">${c.type & TYPE.SPELL ? 'SPELL' : 'TRAP'} ${spellIcon(c.type)}</div>`;
  }
  return `<div class="${cls.join(' ')}" ${data}><div class="cn">${esc(cardName(code))}</div><div class="ca" style="--img:url(${sigilUrl(code)})">${badge}</div>${bottom}</div>`;
}

const fmtStat = (n: number) => (n < 0 ? '?' : String(n));

/** Carta grande para el panel de detalle. */
export function bigCard(code: number, position?: number): string {
  if (!code) return `<div class="bigcard k-back" style="--img:url(${backUrl()})"></div>`;
  const c = card(code);
  const kind = frameKind(c);
  let stars = '';
  if (c && c.type & TYPE.MONSTER && c.level) stars = `<div class="stars">${'★'.repeat(Math.min(12, c.level))}</div>`;
  const attr = c && c.type & TYPE.MONSTER ? `<span class="attr a${c.attribute}">${ATTRIBUTE_SHORT[c.attribute] ?? ''}</span>` : '';
  const pos = position !== undefined && POSITION_NAME[position] ? `<div class="bpos">${POSITION_NAME[position]}</div>` : '';
  return `<div class="bigcard k-${kind}"><div class="cn">${esc(cardName(code))}</div>${stars}<div class="ca" style="--img:url(${sigilUrl(code)})">${attr}</div>${pos}</div>`;
}

/** Ficha de texto de la carta (para el panel de detalle). */
export function cardInfoHtml(code: number, stats?: { attack?: number; defense?: number; level?: number }): string {
  if (!code) return `<h3>Face-down card</h3><p class="muted">You can't see this card.</p>`;
  const c = card(code);
  if (!c) return `<h3>#${code}</h3>`;
  const lines: string[] = [`<h3>${esc(cardName(code))}</h3>`];
  const meta: string[] = [];
  if (c.type & TYPE.MONSTER) {
    meta.push(attributeName(c.attribute));
    if (c.level) meta.push(`Level ${stats?.level ?? c.level}`);
  }
  meta.push(typeLine(c));
  lines.push(`<div class="meta">${meta.map(esc).join(' · ')}</div>`);
  if (c.type & TYPE.MONSTER) {
    const a = stats?.attack ?? c.attack;
    const d = stats?.defense ?? c.defense;
    lines.push(`<div class="atkdef">ATK ${fmtStat(a)}${a !== c.attack && stats?.attack !== undefined ? ` <small>(${fmtStat(c.attack)})</small>` : ''} / DEF ${fmtStat(d)}${d !== c.defense && stats?.defense !== undefined ? ` <small>(${fmtStat(c.defense)})</small>` : ''}</div>`);
  }
  lines.push(`<p class="desc">${esc(c.desc).replace(/\r?\n/g, '<br>')}</p>`);
  return lines.join('');
}
