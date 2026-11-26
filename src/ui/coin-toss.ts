// Volado antes del duelo: Player 1 (o el anfitrión) es HEADS y Player 2 TAILS. Quien gana elige
// si empieza o empieza el otro.

import { play } from './sfx.ts';
import { esc } from './text.ts';

export type CoinSide = 'heads' | 'tails';

export interface CoinTossOpts {
  /** Nombres de [HEADS, TAILS]. */
  names: [string, string];
  result: CoinSide;
  /** Este dispositivo elige (el ganador está aquí). */
  canChoose: boolean;
  onChoose?: (goFirst: boolean) => void;
}

export const randomSide = (): CoinSide => ((crypto.getRandomValues(new Uint8Array(1))[0]! & 1) === 0 ? 'heads' : 'tails');

export function showCoinToss(el: HTMLElement, o: CoinTossOpts): void {
  const winner = o.result === 'heads' ? o.names[0] : o.names[1];
  el.innerHTML = `<div class="screen center toss">
    <h1>COIN TOSS</h1>
    <p class="toss-sides"><b>${esc(o.names[0])}</b> HEADS · <b>${esc(o.names[1])}</b> TAILS</p>
    <div class="coin spin"><span>?</span></div>
    <div class="toss-result" hidden></div>
  </div>`;
  play('decide');
  const coin = el.querySelector<HTMLElement>('.coin')!;
  const res = el.querySelector<HTMLElement>('.toss-result')!;
  setTimeout(() => {
    coin.classList.remove('spin');
    coin.classList.add(o.result);
    coin.innerHTML = `<span>${o.result === 'heads' ? 'H' : 'T'}</span>`;
    play('turn');
    res.hidden = false;
    res.innerHTML = `<h2>${o.result.toUpperCase()}!</h2><p><b>${esc(winner)}</b> wins the toss${o.canChoose ? '' : ' and is choosing who goes first'}.</p>${
      o.canChoose
        ? `<div class="mbtns col"><button class="btn go big" id="toss-first">${esc(winner)}: go first</button><button class="btn big" id="toss-second">${esc(winner)}: go second</button></div>`
        : '<p class="muted">Waiting<span class="dots"></span></p>'
    }`;
    if (o.canChoose) {
      const pick = (goFirst: boolean) => {
        res.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
        o.onChoose?.(goFirst);
      };
      el.querySelector<HTMLElement>('#toss-first')!.onclick = () => pick(true);
      el.querySelector<HTMLElement>('#toss-second')!.onclick = () => pick(false);
    }
  }, 1400);
}
