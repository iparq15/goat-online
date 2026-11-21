// Genera los iconos PNG de la app (sin dependencias) a partir de un dibujo pixel de 16x16:
// una carta con el dorso propio de la app (rombo ámbar) sobre fondo añil.
//   node scripts/gen-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const PALETTE = {
  '.': [0x1a, 0x12, 0x33],
  k: [0x0f, 0x0a, 0x22],
  c: [0xf6, 0xec, 0xd2],
  q: [0x2a, 0x1d, 0x5c],
  p: [0x4a, 0x38, 0x96],
  a: [0xff, 0xb4, 0x3b],
  d: [0xd9, 0x82, 0x2b],
  y: [0xff, 0xe0, 0x8a],
};

// prettier-ignore
const ART = [
  '................',
  '....cccccccc....',
  '....cqpqqpqck...',
  '....cpqqqqpck...',
  '....cqqddqqck...',
  '....cqdaadqck...',
  '....cdayyadck...',
  '....cdayyadck...',
  '....cqdaadqck...',
  '....cqqddqqck...',
  '....cpqqqqpck...',
  '....cqpqqpqck...',
  '....cccccccck...',
  '.....kkkkkkkk...',
  '................',
  '................',
];

/** Color en coordenadas del dibujo (0..16), con margen extra `pad` (en píxeles del dibujo). */
function colorAt(u, v, pad) {
  const n = 16 + pad * 2;
  const x = Math.floor(u * n) - pad;
  // Centra verticalmente la carta (ocupa las filas 1..13).
  const y = Math.floor(v * n) - pad + 0;
  if (x < 0 || y < 0 || x >= 16 || y >= 16) return PALETTE['.'];
  return PALETTE[ART[y][x]] ?? PALETTE['.'];
}

function render(size, pad = 0) {
  const row = size * 3 + 1;
  const raw = Buffer.alloc(size * row);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < size; x++) {
      // La carta (columnas 4..11, filas 1..12) queda centrada bajando el dibujo ~1 píxel.
      const c = colorAt((x + 0.5) / size, (y + 0.5) / size - 0.9 / (16 + pad * 2), pad);
      raw.set(c, y * row + 1 + x * 3);
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
writeFileSync('public/icons/icon-maskable-512.png', render(512, 3));
writeFileSync('public/favicon.png', render(64));
console.log('Iconos generados en public/icons/');
