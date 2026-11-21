import { defineConfig } from 'vite';

export default defineConfig({
  // .trycloudflare.com: túneles temporales para probar desde el móvil.
  server: { port: 5180, host: true, allowedHosts: ['.trycloudflare.com'] },
  preview: { port: 5181, host: true, allowedHosts: ['.trycloudflare.com'] },
  build: { outDir: 'dist', assetsInlineLimit: 0, target: 'es2022' },
  optimizeDeps: { exclude: ['ocgcore-wasm'] },
});
