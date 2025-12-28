import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  define: {
    global: 'globalThis',
    Buffer: 'Buffer',
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      buffer: 'buffer',
    },
  },
  optimizeDeps: {
    include: ['@solana/web3.js', 'buffer'],
    exclude: ['@memecoin-lending/sdk', '@memecoin-lending/types', '@memecoin-lending/config'],
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      external: [],
      output: {
        globals: {
          buffer: 'Buffer',
        },
      },
    },
  },
  server: {
    port: 3000,
  },
  preview: {
    port: 3000,
  },
});