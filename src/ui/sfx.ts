// Efectos de sonido sintetizados (onda cuadrada, estilo portátil). Sin archivos de audio.
// En iOS el audio solo puede empezar tras un toque: se desbloquea en el primer toque y se
// suspende cuando la app pasa a segundo plano.

import { playCustomSound } from './custom-sound.ts';
import { settings } from './settings.ts';

export type Sfx = 'tap' | 'draw' | 'summon' | 'set' | 'activate' | 'attack' | 'damage' | 'heal' | 'turn' | 'decide' | 'win' | 'lose' | 'grave';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Llamar una vez al arrancar: desbloquea el audio con el primer toque (iOS). */
export function initSfx(): void {
  const unlock = () => {
    const a = audio();
    if (a && a.state !== 'running') void a.resume();
    // Un buffer vacío "despierta" el audio en Safari.
    if (a) {
      const b = a.createBufferSource();
      b.buffer = a.createBuffer(1, 1, 22050);
      b.connect(a.destination);
      b.start(0);
    }
  };
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('touchend', unlock, { once: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.visibilityState === 'hidden') void ctx.suspend();
    else void ctx.resume();
  });
}

/** [frecuencia Hz, duración s] de cada nota. 0 Hz = silencio. */
const TUNES: Record<Sfx, [number, number][]> = {
  tap: [[880, 0.03]],
  draw: [[660, 0.04], [990, 0.05]],
  summon: [[392, 0.05], [523, 0.05], [784, 0.08]],
  set: [[330, 0.05], [262, 0.07]],
  activate: [[784, 0.04], [1047, 0.04], [1319, 0.07]],
  attack: [[220, 0.04], [165, 0.04], [110, 0.09]],
  damage: [[180, 0.06], [120, 0.12]],
  heal: [[523, 0.05], [659, 0.05], [880, 0.08]],
  turn: [[523, 0.06], [0, 0.02], [784, 0.1]],
  decide: [[1175, 0.05], [1568, 0.07]],
  win: [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.25]],
  lose: [[392, 0.12], [330, 0.12], [262, 0.3]],
  grave: [[294, 0.05], [196, 0.09]],
};

export function play(name: Sfx): void {
  if (!settings().sound) return;
  // Perder LP (daño o pago de LP): el sonido propio importado en Settings, si lo hay.
  if (name === 'damage' && playCustomSound()) return;
  const a = ctx;
  if (!a || a.state !== 'running') return;
  let t = a.currentTime + 0.01;
  const gain = a.createGain();
  gain.gain.value = 0.06;
  gain.connect(a.destination);
  for (const [freq, dur] of TUNES[name]) {
    if (freq > 0) {
      const o = a.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(freq, t);
      o.connect(gain);
      o.start(t);
      o.stop(t + dur);
    }
    t += dur;
  }
  setTimeout(() => gain.disconnect(), (t - a.currentTime + 0.1) * 1000);
}
