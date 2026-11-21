// Ajustes del jugador (guardados en este dispositivo).

export interface Settings {
  /** Efectos de sonido. */
  sound: boolean;
  /** Elegir sola la zona al invocar o colocar (si no, se pregunta siempre). */
  autoZone: boolean;
  /**
   * Avisos para encadenar:
   * - 'smart': no pregunta en cambios de fase sin nada que responder, salvo en la fase de
   *   batalla y la fase final del rival (los momentos clásicos para Scapegoat, etc.).
   * - 'always': pregunta en cada oportunidad (como "always chain" de EDOPro).
   */
  chains: 'smart' | 'always';
}

const KEY = 'goat.settings';
const DEFAULTS: Settings = { sound: true, autoZone: true, chains: 'smart' };

let current: Settings = load();

function load(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = (): Settings => current;

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* sin almacenamiento */
  }
}
