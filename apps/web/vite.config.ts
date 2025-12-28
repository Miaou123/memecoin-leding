import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  optimizeDeps: {
    include: ['@solana/web3.js'],
    exclude: ['@memecoin-lending/sdk', '@memecoin-lending/types', '@memecoin-lending/config'],
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      external: [],
    },
  },
  server: {
    port: 3000,
  },
  preview: {
    port: 3000,
  },
});