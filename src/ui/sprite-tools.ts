// Utilidades para componer los iconos pixel 16x16 (filas de texto, '.' = transparente).

export type Sprite = string[];

/** Cambia letras de color: re(s, { a: 'u' }). */
export const re = (s: Sprite, map: Record<string, string>): Sprite =>
  s.map((r) => [...r].map((ch) => map[ch] ?? ch).join(''));

/** Espejo horizontal. */
export const flipX = (s: Sprite): Sprite => s.map((r) => [...r].reverse().join(''));

/** Pinta `top` encima de `base` en (x, y), sin tocar los '.' de `top`. */
export function over(base: Sprite, top: Sprite, x = 0, y = 0): Sprite {
  const out = base.map((r) => [...r]);
  top.forEach((row, dy) => {
    [...row].forEach((ch, dx) => {
      const yy = y + dy;
      const xx = x + dx;
      if (ch !== '.' && out[yy] && xx >= 0 && xx < 16) out[yy][xx] = ch;
    });
  });
  return out.map((r) => r.join(''));
}

const DIGITS: Record<string, string[]> = {
  '2': ['yyy', '..y', 'yyy', 'y..', 'yyy'],
  '3': ['yyy', '..y', '.yy', '..y', 'yyy'],
  '4': ['y.y', 'y.y', 'yyy', '..y', '..y'],
  '5': ['yyy', 'y..', 'yyy', '..y', 'yyy'],
  '6': ['yyy', 'y..', 'yyy', 'y.y', 'yyy'],
  '7': ['yyy', '..y', '..y', '.y.', '.y.'],
  '8': ['yyy', 'y.y', 'yyy', 'y.y', 'yyy'],
};

/** Insignia de nivel (cartas "LV"): un dígito dorado en la esquina inferior derecha. */
export function lv(s: Sprite, n: number): Sprite {
  const box = ['kkkkk', 'kkkkk', 'kkkkk', 'kkkkk', 'kkkkk', 'kkkkk', 'kkkkk'];
  const d = DIGITS[String(n)] ?? [];
  return over(over(s, box, 11, 9), d, 12, 10);
}
