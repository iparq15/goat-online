// Ilustraciones de cartas que el jugador importa (un .zip con <código>.png) y que se guardan SOLO
// en este dispositivo (IndexedDB). La app no incluye ni descarga ninguna: las aporta el usuario
// (p. ej. el pack de scripts/make-pic-pack.py, hecho con su propia instalación de Project Ignis).

const DB = 'goat-pics';
const STORE = 'pics';
const urls = new Map<number, string>();

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = (t: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('Could not save on this device (storage full or private mode?).'));
    t.onabort = () => reject(t.error ?? new Error('Could not save on this device (storage full or private mode?).'));
  });

/** Ilustración importada de una carta (por código raíz), si la hay. */
export const picUrl = (root: number): string | undefined => urls.get(root);
export const picCount = (): number => urls.size;

/** Carga en memoria las ilustraciones guardadas (al arrancar). */
export async function loadPics(): Promise<number> {
  try {
    const db = await open();
    const t = db.transaction(STORE, 'readonly');
    const store = t.objectStore(STORE);
    await new Promise<void>((resolve, reject) => {
      const req = store.openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve();
        const code = Number(c.key);
        const v = c.value as StoredPic | Blob;
        const blob = v instanceof Blob ? v : new Blob([v.data], { type: v.type });
        if (!urls.has(code)) urls.set(code, URL.createObjectURL(blob));
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch (e) {
    console.warn('Sin ilustraciones importadas', e);
  }
  return urls.size;
}

export async function clearPics(): Promise<void> {
  const db = await open();
  const t = db.transaction(STORE, 'readwrite');
  t.objectStore(STORE).clear();
  await done(t);
  db.close();
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
}

/** Se guardan bytes (no Blob): WebKit no admite Blob en IndexedDB en algunos modos. */
interface StoredPic {
  type: string;
  data: ArrayBuffer;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

/** Importa un .zip de imágenes <código>.<png|jpg|webp>. Devuelve cuántas se guardaron. */
export async function importPics(file: File, progress: (done: number, total: number) => void): Promise<number> {
  const entries = await readZip(new Uint8Array(await file.arrayBuffer()));
  const pics = entries
    .map((e) => {
      const m = /(?:^|\/)(\d+)\.(png|jpe?g|webp|gif)$/i.exec(e.name);
      return m ? { code: Number(m[1]), type: MIME[m[2]!.toLowerCase()]!, entry: e } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (!pics.length) throw new Error('The .zip has no card pictures (files named <card code>.png).');
  const db = await open();
  const BATCH = 100;
  for (let i = 0; i < pics.length; i += BATCH) {
    const part = pics.slice(i, i + BATCH);
    const bytes = await Promise.all(part.map(async (p) => (await p.entry.data()).slice().buffer as ArrayBuffer));
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    part.forEach((p, k) => {
      const rec: StoredPic = { type: p.type, data: bytes[k]! };
      store.put(rec, p.code);
      const old = urls.get(p.code);
      if (old) URL.revokeObjectURL(old);
      urls.set(p.code, URL.createObjectURL(new Blob([rec.data], { type: rec.type })));
    });
    await done(t);
    progress(Math.min(i + BATCH, pics.length), pics.length);
  }
  db.close();
  return pics.length;
}

// ---------- lector de .zip mínimo (sin compresión o deflate) ----------

interface ZipEntry {
  name: string;
  data: () => Promise<Uint8Array>;
}

async function inflate(raw: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Blob([raw as Uint8Array<ArrayBuffer>]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

async function readZip(buf: Uint8Array): Promise<ZipEntry[]> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Fin del directorio central (está en los últimos 64 KB + 22 bytes).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('That file is not a .zip.');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged .zip.');
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = buf.subarray(start, start + size);
    if (method === 0) out.push({ name, data: async () => raw });
    else if (method === 8) out.push({ name, data: () => inflate(raw) });
  }
  return out;
}
