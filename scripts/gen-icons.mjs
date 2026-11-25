// Genera los iconos PNG de la app (sin dependencias): los dos dorsos de las cartas de la app,
// azul y rojo, uno al lado del otro (rectángulo de color con óvalo y contorno negros) sobre el
// fondo añil. Se dibuja con geometría y suavizado, así queda nítido en cualquier tamaño.
//   node scripts/gen-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x1a, 0x12, 0x33];
const BLACK = [0x0b, 0x0b, 0x10];
const BLUE = [0x2f, 0x6f, 0xe0];
const RED = [0xd6, 0x3a, 0x3a];
const SHADOW = [0x0d, 0x08, 0x1e];

/** Dos cartas en coordenadas 0..1: ancho 0.34, alto 0.48 (proporción de carta). */
const CARD_W = 0.34;
const CARD_H = 0.48;
const CARDS = [
  { x: 0.14, y: 0.25, color: BLUE },
  { x: 0.52, y: 0.27, color: RED },
];

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Color en un punto (u, v) del icono. `k` encoge el dibujo (margen de los iconos "maskable"). */
function colorAt(u, v, k) {
  const x = (u - 0.5) / k + 0.5;
  const y = (v - 0.5) / k + 0.5;
  const line = 0.022;
  let c = BG;
  // Sombra dura de cada carta.
  for (const card of CARDS) {
    if (x >= card.x + 0.025 && x <= card.x + CARD_W + 0.025 && y >= card.y + 0.025 && y <= card.y + CARD_H + 0.025) c = SHADOW;
  }
  for (const card of CARDS) {
    if (x < card.x || x > card.x + CARD_W || y < card.y || y > card.y + CARD_H) continue;
    // Contorno negro.
    if (x < card.x + line || x > card.x + CARD_W - line || y < card.y + line || y > card.y + CARD_H - line) {
      c = BLACK;
      continue;
    }
    // Óvalo negro en el centro (30% del ancho y del alto, como en la app).
    const ox = (x - (card.x + CARD_W / 2)) / (CARD_W * 0.3);
    const oy = (y - (card.y + CARD_H / 2)) / (CARD_H * 0.3);
    if (ox * ox + oy * oy <= 1) {
      c = BLACK;
      continue;
    }
    // Relleno con un brillo diagonal suave.
    const t = ((x - card.x) / CARD_W + (y - card.y) / CARD_H) / 2;
    c = t < 0.5 ? mix(card.color, [255, 255, 255], (0.5 - t) * 0.35) : mix(card.color, [0, 0, 0], (t - 0.5) * 0.35);
  }
  return c;
}

function render(size, k = 1) {
  const row = size * 3 + 1;
  const raw = Buffer.alloc(size * row);
  const S = 4; // 4x4 muestras por píxel
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const c = colorAt((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size, k);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = S * S;
      raw.set([Math.round(r / n), Math.round(g / n), Math.round(b / n)], y * row + 1 + x * 3);
    }
  }
  return png(size, raw);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/apple-touch-icon.png', render(180));
writeFileSync('public/icons/icon-192.png', render(192));
writeFileSync('public/icons/icon-512.png', render(512));
// "maskable": con margen para que Android pueda recortarlo en círculo.
writeFileSync('public/icons/icon-maskable-512.png', render(512, 0.8));
writeFileSync('public/favicon.png', render(64));
console.log('Iconos generados en public/icons/');
