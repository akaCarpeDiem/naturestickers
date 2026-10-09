import { defineConfig } from 'vite';
import { resolve } from 'path';

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
      },
    },
  },
});
