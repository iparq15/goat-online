// Modo marcador (LP Calculator) para duelos en físico: dos marcadores de LP, teclado con
// + − × ÷, ceros automáticos, historial con deshacer, moneda y dado. Se guarda en el dispositivo.

import { play } from './sfx.ts';
import { keepAwake } from './wake.ts';

type Op = '+' | '-' | '*' | '/';

interface Entry {
  /** Jugador (0/1) o -1 para moneda/dado. */
  p: number;
  text: string;
  /** LP antes de la operación (para deshacer). */
  before?: number;
}

interface State {
  start: 8000 | 4000;
  lp: [number, number];
  names: [string, string];
  log: Entry[];
}

const KEY = 'goat.calc';
const OPS: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };
const MAX_LP = 999999;

function load(): State {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as State | null;
    if (s && Array.isArray(s.lp) && s.lp.length === 2) return s;
  } catch {
    /* estado dañado: se empieza de cero */
  }
  return { start: 8000, lp: [8000, 8000], names: ['Player 1', 'Player 2'], log: [] };
}

function save(s: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento */
  }
}

/**
 * Valor que se aplica al pulsar "=". Con + y −, si el número no termina en 0 se le añaden dos
 * ceros (5 → 500, 15 → 1500); si ya lleva un cero al final, se usa tal cual.
 */
export function entryValue(digits: string, op: Op): number {
  let d = digits.replace(/^0+(?=\d)/, '');
  if ((op === '+' || op === '-') && d && !d.endsWith('0')) d += '00';
  return Number(d || '0');
}

export function applyOp(lp: number, op: Op, n: number): number {
  let v = lp;
  if (op === '+') v = lp + n;
  else if (op === '-') v = lp - n;
  else if (op === '*') v = lp * n;
  else if (op === '/') v = n ? Math.ceil(lp / n) : lp;
  return Math.max(0, Math.min(MAX_LP, Math.round(v)));
}

export function showCalculator(app: HTMLElement, onBack: () => void): void {
  const st = load();
  let target = 0;
  let op: Op | null = null;
  let digits = '';
  const shown: [number, number] = [st.lp[0], st.lp[1]];
  const tweens: [number, number] = [0, 0];
  keepAwake(true);

  app.innerHTML = `<div class="calc">
    <div class="ctop">
      <button class="cbtn" data-k="back" aria-label="Back to menu">‹</button>
      <button class="cbtn" data-k="coin">COIN</button>
      <button class="cbtn" data-k="dice">DICE</button>
      <button class="cbtn" data-k="log">LOG</button>
      <button class="cbtn" data-k="new">NEW</button>
    </div>
    ${[1, 0]
      .map(
        (p) => `<button class="lpbox" data-p="${p}">
        <span class="lpname" data-name="${p}"></span>
        <span class="lpnum" id="lp${p}"></span>
        <span class="lpop" id="op${p}"></span>
      </button>`,
      )
      .join('')}
    <div class="ckeys">
      ${['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '00', '000', '+']
        .map((k) => `<button class="ckey ${k in OPS ? 'op' : ''}" data-k="${k}">${OPS[k as Op] ?? k}</button>`)
        .join('')}
      <button class="ckey fn" data-k="C">C</button>
      <button class="ckey fn" data-k="del" aria-label="Delete">⌫</button>
      <button class="ckey eq" data-k="=">=</button>
    </div>
    <div class="cfx" hidden></div>
  </div>`;

  const root = app.querySelector<HTMLElement>('.calc')!;
  const fx = root.querySelector<HTMLElement>('.cfx')!;
  const num = (p: number) => root.querySelector<HTMLElement>(`#lp${p}`)!;

  function paint(): void {
    for (const p of [0, 1]) {
      const box = root.querySelector<HTMLElement>(`.lpbox[data-p="${p}"]`)!;
      box.classList.toggle('sel', p === target);
      box.classList.toggle('dead', st.lp[p] === 0);
      root.querySelector<HTMLElement>(`[data-name="${p}"]`)!.textContent = st.names[p]!;
      num(p).textContent = String(shown[p]);
      const pend = p === target && (op || digits) ? `${op ? OPS[op] : ''} ${digits || ''}`.trim() : '';
      root.querySelector<HTMLElement>(`#op${p}`)!.textContent = pend;
    }
  }

  /** Los LP cuentan hasta el valor nuevo. */
  function tween(p: number, to: number): void {
    cancelAnimationFrame(tweens[p]!);
    const from = shown[p]!;
    const t0 = performance.now();
    const dur = Math.min(1100, 350 + Math.abs(to - from) / 8);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      shown[p] = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
      num(p).textContent = String(shown[p]);
      if (k < 1) tweens[p] = requestAnimationFrame(step);
    };
    tweens[p] = requestAnimationFrame(step);
  }

  function commit(): void {
    if (!digits) return;
    const o = op ?? '-';
    const n = entryValue(digits, o);
    const before = st.lp[target]!;
    const after = applyOp(before, o, n);
    st.lp[target] = after;
    st.log.unshift({ p: target, before, text: `${st.names[target]}: ${before} ${OPS[o]} ${n} = ${after}` });
    st.log = st.log.slice(0, 200);
    save(st);
    play(after < before ? 'damage' : 'heal');
    op = null;
    digits = '';
    tween(target, after);
    paint();
    if (after === 0) setTimeout(() => banner(`${st.names[target]}\nLP 0`), 500);
  }

  function banner(text: string, cls = ''): void {
    fx.hidden = false;
    fx.className = `cfx ${cls}`;
    fx.innerHTML = `<div class="cfx-in">${text
      .split('\n')
      .map((l) => `<div>${l.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</div>`)
      .join('')}</div>`;
  }

  function coin(): void {
    const heads = Math.random() < 0.5;
    play('decide');
    fx.hidden = false;
    fx.className = 'cfx';
    fx.innerHTML = `<div class="coin spin"><span>?</span></div>`;
    setTimeout(() => {
      fx.innerHTML = `<div class="coin ${heads ? 'heads' : 'tails'}"><span>${heads ? 'H' : 'T'}</span></div><div class="cfx-in"><div>${heads ? 'HEADS' : 'TAILS'}</div></div>`;
      st.log.unshift({ p: -1, text: `Coin: ${heads ? 'Heads' : 'Tails'}` });
      save(st);
    }, 900);
  }

  function dice(): void {
    const n = 1 + Math.floor(Math.random() * 6);
    play('decide');
    fx.hidden = false;
    fx.className = 'cfx';
    const face = (v: number) => `<div class="die d${v}">${'<i></i>'.repeat(v)}</div>`;
    fx.innerHTML = face(1 + Math.floor(Math.random() * 6));
    const die = fx.querySelector<HTMLElement>('.die')!;
    die.classList.add('roll');
    let i = 0;
    const iv = setInterval(() => {
      fx.innerHTML = face(1 + Math.floor(Math.random() * 6));
      fx.querySelector<HTMLElement>('.die')!.classList.add('roll');
      if (++i >= 7) {
        clearInterval(iv);
        fx.innerHTML = `${face(n)}<div class="cfx-in"><div>DICE: ${n}</div></div>`;
        st.log.unshift({ p: -1, text: `Dice: ${n}` });
        save(st);
      }
    }, 110);
  }

  function showLog(): void {
    fx.hidden = false;
    fx.className = 'cfx sheet-like';
    const rows = st.log.length ? st.log.map((e) => `<li class="${e.p < 0 ? 'misc' : `p${e.p}`}">${e.text.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</li>`).join('') : '<li class="misc">Nothing yet.</li>';
    fx.innerHTML = `<div class="clog" data-stop="1"><h2>LOG</h2><ol>${rows}</ol>
      <div class="clog-btns"><button class="cbtn" data-k="undo" ${st.log.some((e) => e.p >= 0) ? '' : 'disabled'}>Undo last</button><button class="cbtn" data-k="close">Close</button></div></div>`;
  }

  function undo(): void {
    const i = st.log.findIndex((e) => e.p >= 0 && e.before !== undefined);
    if (i < 0) return;
    const e = st.log[i]!;
    st.log.splice(i, 1);
    st.lp[e.p] = e.before!;
    save(st);
    tween(e.p, e.before!);
    paint();
    showLog();
  }

  function newDuel(): void {
    fx.hidden = false;
    fx.className = 'cfx sheet-like';
    fx.innerHTML = `<div class="clog" data-stop="1"><h2>NEW DUEL</h2><p>Starting Life Points</p>
      <div class="clog-btns"><button class="cbtn big ${st.start === 8000 ? 'on' : ''}" data-k="start8000">8000</button><button class="cbtn big ${st.start === 4000 ? 'on' : ''}" data-k="start4000">4000</button></div>
      <div class="clog-btns"><button class="cbtn" data-k="close">Cancel</button></div></div>`;
  }

  function start(v: 8000 | 4000): void {
    st.start = v;
    st.lp = [v, v];
    st.log = [];
    save(st);
    op = null;
    digits = '';
    tween(0, v);
    tween(1, v);
    fx.hidden = true;
    play('turn');
    paint();
  }

  root.onclick = (ev) => {
    const t = ev.target as HTMLElement;
    // Toque fuera de un panel abierto (moneda, dado, log): se cierra.
    if (!fx.hidden && fx.contains(t) && !t.closest('[data-k]') && !t.closest('[data-stop]')) {
      fx.hidden = true;
      return;
    }
    const nameEl = t.closest<HTMLElement>('[data-name]');
    if (nameEl) {
      const p = Number(nameEl.dataset.name);
      const n = prompt('Player name', st.names[p]);
      if (n && n.trim()) {
        st.names[p] = n.trim().slice(0, 20);
        save(st);
      }
      target = p;
      paint();
      return;
    }
    const box = t.closest<HTMLElement>('.lpbox');
    if (box) {
      const p = Number(box.dataset.p);
      if (p !== target) {
        target = p;
        op = null;
        digits = '';
      }
      play('tap');
      paint();
      return;
    }
    const k = t.closest<HTMLElement>('[data-k]')?.dataset.k;
    if (!k) return;
    if (/^\d+$/.test(k)) {
      if (digits.length + k.length <= 6) digits += k;
      play('tap');
    } else if (k in OPS) {
      op = k as Op;
      play('tap');
    } else if (k === '=') commit();
    else if (k === 'C') {
      op = null;
      digits = '';
    } else if (k === 'del') digits = digits.slice(0, -1);
    else if (k === 'coin') coin();
    else if (k === 'dice') dice();
    else if (k === 'log') showLog();
    else if (k === 'undo') undo();
    else if (k === 'close') fx.hidden = true;
    else if (k === 'new') newDuel();
    else if (k === 'start8000') start(8000);
    else if (k === 'start4000') start(4000);
    else if (k === 'back') {
      keepAwake(false);
      root.onclick = null;
      onBack();
      return;
    }
    paint();
  };
  paint();
}
