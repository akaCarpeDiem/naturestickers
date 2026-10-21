import { defineConfig } from 'vite';
import fs from 'fs';
import { resolve } from 'path';

// Per-sticker pages written by tools/build-state-pages.mjs (shop/<key>.html → /shop/<key>).
const shopDir = resolve(__dirname, 'shop');
const statePages = fs.existsSync(shopDir)
  ? Object.fromEntries(
      fs.readdirSync(shopDir)
        .filter((f) => f.endsWith('.html'))
        .map((f) => [`shop-${f.slice(0, -5)}`, resolve(shopDir, f)]),
    )
  : {};

// Image-source pages from the same script (sources/<key>.html → /sources/<key>).
const sourcesDir = resolve(__dirname, 'sources');
const sourcePages = fs.existsSync(sourcesDir)
  ? Object.fromEntries(
      fs.readdirSync(sourcesDir)
        .filter((f) => f.endsWith('.html'))
        .map((f) => [`sources-${f.slice(0, -5)}`, resolve(sourcesDir, f)]),
    )
  : {};

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        terms: resolve(__dirname, 'terms.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        shop: resolve(__dirname, 'shop.html'),
        thanks: resolve(__dirname, 'thanks.html'),
        contact: resolve(__dirname, 'contact.html'),
        support: resolve(__dirname, 'support.html'),
        returns: resolve(__dirname, 'returns.html'),
        ...statePages,
        ...sourcePages,
      },
    },
  },
});
