import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The production build is a single self-contained dist/index.html (models,
// fonts and code are inlined) so the game can be opened by double-clicking.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 5000 },
});
