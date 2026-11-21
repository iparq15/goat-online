import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

const API = process.env.GOAT_API ?? 'http://127.0.0.1:8788';

/**
 * Rellena dist/sw.js con la lista de archivos que el service worker guarda al instalarse (para
 * jugar sin conexión) y una versión que cambia con cada build. Se omiten las copias en base64
 * del motor que la app no usa (carga el .wasm directamente).
 */
function precache(): Plugin {
  let files: string[] = [];
  return {
    name: 'goat-precache',
    apply: 'build',
    generateBundle(_opts, bundle) {
      files = Object.values(bundle)
        .filter((f) => {
          const size = f.type === 'chunk' ? f.code.length : typeof f.source === 'string' ? f.source.length : f.source.byteLength;
          if (/ocgcore\.(jspi|sync)-.*\.js$/.test(f.fileName) && size > 500_000) return false;
          if (/ocgcore\.jspi/.test(f.fileName)) return false;
          if (/\.woff$/.test(f.fileName)) return false;
          return /\.(js|css|json|wasm|woff2)$/.test(f.fileName);
        })
        .map((f) => `/${f.fileName}`)
        .sort();
    },
    closeBundle() {
      const path = 'dist/sw.js';
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const src = readFileSync(path, 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('self.__PRECACHE__ ?? []', JSON.stringify(files));
      writeFileSync(path, src);
      console.log(`sw.js: ${files.length} archivos para usar sin conexión (versión ${version})`);
    },
  };
}

export default defineConfig({
  plugins: [precache()],
  // .trycloudflare.com: túneles temporales para probar desde el móvil.
  // /api -> servidor local (npm run server:dev) en desarrollo.
  server: { port: 5180, host: true, allowedHosts: ['.trycloudflare.com'], proxy: { '/api': { target: API, ws: true } } },
  preview: { port: 5181, host: true, allowedHosts: ['.trycloudflare.com'], proxy: { '/api': { target: API, ws: true } } },
  build: { outDir: 'dist', assetsInlineLimit: 0, target: 'es2022', chunkSizeWarningLimit: 1500 },
  optimizeDeps: { exclude: ['ocgcore-wasm'] },
});
