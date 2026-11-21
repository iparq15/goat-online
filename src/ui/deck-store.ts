// Mazos del usuario en IndexedDB (con localStorage de respaldo si IndexedDB no está disponible,
// p. ej. en algunos modos privados).

import type { Deck } from '../engine/ydk.ts';

export interface StoredDeck {
  id: string;
  name: string;
  deck: Deck;
  updated: number;
}

const DB = 'goat-online';
const STORE = 'decks';
const LS_KEY = 'goat.decks';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

const lsRead = (): StoredDeck[] => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as StoredDeck[];
  } catch {
    return [];
  }
};
const lsWrite = (decks: StoredDeck[]) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(decks));
  } catch {
    /* sin almacenamiento */
  }
};

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listDecks(): Promise<StoredDeck[]> {
  const db = await openDb();
  const all = db ? await tx<StoredDeck[]>(db, 'readonly', (s) => s.getAll() as IDBRequest<StoredDeck[]>) : lsRead();
  return all.sort((a, b) => b.updated - a.updated);
}

export async function getDeck(id: string): Promise<StoredDeck | undefined> {
  const db = await openDb();
  if (!db) return lsRead().find((d) => d.id === id);
  return tx<StoredDeck | undefined>(db, 'readonly', (s) => s.get(id) as IDBRequest<StoredDeck | undefined>);
}

export async function saveDeck(d: StoredDeck): Promise<void> {
  d.updated = Date.now();
  const db = await openDb();
  if (!db) {
    const all = lsRead().filter((x) => x.id !== d.id);
    all.push(d);
    return lsWrite(all);
  }
  await tx(db, 'readwrite', (s) => s.put(d));
}

export async function deleteDeck(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return lsWrite(lsRead().filter((x) => x.id !== id));
  await tx(db, 'readwrite', (s) => s.delete(id));
}

export function newId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Pasa los mazos importados en la Fase 3 (localStorage) a IndexedDB, una sola vez. */
export async function migrateLegacy(): Promise<void> {
  try {
    const raw = localStorage.getItem('goat.imported');
    if (!raw) return;
    const old = JSON.parse(raw) as { name: string; deck: Deck }[];
    for (const d of old) await saveDeck({ id: newId(), name: d.name, deck: d.deck, updated: 0 });
    localStorage.removeItem('goat.imported');
  } catch {
    /* nada que migrar */
  }
}
