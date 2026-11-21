import { defineConfig } from 'vite';

const API = process.env.GOAT_API ?? 'http://127.0.0.1:8788';

export default defineConfig({
  // .trycloudflare.com: túneles temporales para probar desde el móvil.
  // /api -> servidor local (npm run server:dev) en desarrollo.
  server: { port: 5180, host: true, allowedHosts: ['.trycloudflare.com'], proxy: { '/api': { target: API, ws: true } } },
  preview: { port: 5181, host: true, allowedHosts: ['.trycloudflare.com'], proxy: { '/api': { target: API, ws: true } } },
  build: { outDir: 'dist', assetsInlineLimit: 0, target: 'es2022' },
  optimizeDeps: { exclude: ['ocgcore-wasm'] },
});
