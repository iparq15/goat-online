// Sonido propio del "=" de la calculadora de LP: un archivo de audio que el usuario importa y que
// se guarda SOLO en este dispositivo (IndexedDB). La app no incluye ninguno.

import { settings } from './settings.ts';

const DB = 'goat-sound';
const STORE = 'sound';
const KEY = 'lp';

interface StoredSound {
  name: string;
  type: string;
  data: ArrayBuffer;
}

let audio: HTMLAudioElement | null = null;
let url = '';
let name = '';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function use(rec: StoredSound | undefined): void {
  if (url) URL.revokeObjectURL(url);
  url = '';
  audio = null;
  name = '';
  if (!rec) return;
  url = URL.createObjectURL(new Blob([rec.data], { type: rec.type }));
  audio = new Audio(url);
  audio.preload = 'auto';
  name = rec.name;
}

async function write(rec: StoredSound | null): Promise<void> {
  const db = await open();
  const t = db.transaction(STORE, 'readwrite');
  if (rec) t.objectStore(STORE).put(rec, KEY);
  else t.objectStore(STORE).delete(KEY);
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('Could not save on this device.'));
    t.onabort = () => reject(t.error ?? new Error('Could not save on this device.'));
  });
  db.close();
}

/** Carga el sonido guardado (al arrancar). */
export async function loadCustomSound(): Promise<void> {
  try {
    const db = await open();
    const rec = await new Promise<StoredSound | undefined>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result as StoredSound | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    use(rec);
  } catch (e) {
    console.warn('Sin sonido propio', e);
  }
}

export const customSoundName = (): string => name;

export async function importCustomSound(file: File): Promise<void> {
  if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|aac|wav|ogg)$/i.test(file.name)) throw new Error('That is not an audio file.');
  if (file.size > 3 * 1024 * 1024) throw new Error('The sound is too big (max 3 MB).');
  const rec: StoredSound = { name: file.name, type: file.type || 'audio/mpeg', data: await file.arrayBuffer() };
  await write(rec);
  use(rec);
}

export async function removeCustomSound(): Promise<void> {
  await write(null);
  use(undefined);
}

/** Reproduce el sonido propio. Devuelve false si no hay (para usar el efecto por defecto). */
export function playCustomSound(): boolean {
  if (!audio) return false;
  if (!settings().sound) return true;
  audio.currentTime = 0;
  void audio.play().catch(() => {});
  return true;
}
