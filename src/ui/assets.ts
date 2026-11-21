// Carga del motor (WASM) y de los datos del cardpool GOAT en el navegador.

import createCore, { type OcgCoreSync } from 'ocgcore-wasm';
import wasmUrl from 'ocgcore-wasm/lib/ocgcore.sync.wasm?url';
import cardsUrl from '../../data/goat/cards.json?url';
import scriptsUrl from '../../data/goat/scripts.json?url';
import lflistUrl from '../../data/goat/lflist.json?url';
import stringsUrl from '../../data/goat/strings.json?url';
import { parseGoatData, type GoatData, type RawGoatData } from '../engine/data.ts';
import type { Strings } from './text.ts';

export interface Assets {
  data: GoatData;
  strings: Strings;
  /** Solo para el duelo local (en el modo online el motor corre en el servidor). */
  core: () => Promise<OcgCoreSync>;
}

let corePromise: Promise<OcgCoreSync> | null = null;

const getJson = async <T>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Couldn't load ${url} (${r.status})`);
  return (await r.json()) as T;
};

export async function loadAssets(onProgress?: (done: number, total: number) => void): Promise<Assets> {
  let done = 0;
  const tick = <T>(p: Promise<T>) =>
    p.then((v) => {
      onProgress?.(++done, 4);
      return v;
    });
  const [cards, scripts, lflist, strings] = await Promise.all([
    tick(getJson<RawGoatData['cards']>(cardsUrl)),
    tick(getJson<RawGoatData['scripts']>(scriptsUrl)),
    tick(getJson<RawGoatData['lflist']>(lflistUrl)),
    tick(getJson<Strings>(stringsUrl)),
  ]);
  return {
    data: parseGoatData({ cards, scripts, lflist }),
    strings,
    core: () => (corePromise ??= createCore({ sync: true, locateFile: () => wasmUrl })),
  };
}
