// Mantiene la pantalla encendida durante un duelo (Screen Wake Lock; Safari 16.4+).
// iOS lo libera al pasar a segundo plano, así que se vuelve a pedir al volver.

type Sentinel = { release(): Promise<void> };
let sentinel: Sentinel | null = null;
let wanted = false;

async function request(): Promise<void> {
  const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }).wakeLock;
  if (!wl || !wanted || document.visibilityState !== 'visible') return;
  try {
    sentinel = await wl.request('screen');
  } catch {
    /* no permitido (p. ej. modo de bajo consumo) */
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wanted) void request();
});

export function keepAwake(on: boolean): void {
  wanted = on;
  if (on) void request();
  else {
    void sentinel?.release().catch(() => {});
    sentinel = null;
  }
}
