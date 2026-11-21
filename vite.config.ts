import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5180, host: true },
  preview: { port: 5181, host: true },
  build: { outDir: 'dist', assetsInlineLimit: 0, target: 'es2022' },
  optimizeDeps: { exclude: ['ocgcore-wasm'] },
});
