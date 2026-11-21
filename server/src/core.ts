// Motor GOAT dentro de un Worker de Cloudflare.
// Los Workers no permiten compilar WebAssembly desde bytes: se importa el .wasm como
// módulo y se instancia con `instantiateWasm`. `locateFile` evita que el paquete cargue
// su copia embebida en base64.

import createCore, { type OcgCoreSync } from 'ocgcore-wasm';
import wasmModule from 'ocgcore-wasm/lib/ocgcore.sync.wasm';
import cardsJson from '../../data/goat/cards.json';
import scriptsJson from '../../data/goat/scripts.json';
import lflistJson from '../../data/goat/lflist.json';
import { parseGoatData, type GoatData, type RawGoatData } from '../../src/engine/data.ts';

let corePromise: Promise<OcgCoreSync> | null = null;

export function getCore(): Promise<OcgCoreSync> {
  corePromise ??= createCore({
    sync: true,
    locateFile: (url: string) => url,
    instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) {
      WebAssembly.instantiate(wasmModule, imports).then((instance) => done(instance, wasmModule));
      return {};
    },
  });
  return corePromise;
}

let data: GoatData | null = null;

export function getData(): GoatData {
  data ??= parseGoatData({
    cards: cardsJson,
    scripts: scriptsJson,
    lflist: lflistJson,
  } as unknown as RawGoatData);
  return data;
}
