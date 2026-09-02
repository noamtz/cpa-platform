import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  logLevel: 'error', // Suppress warnings, only show errors
  plugins: [
    react(),
  ],
  // [POC TEST] Temporarily disabled to prevent pdfme from loading
  // optimizeDeps: {
  //   include: [
  //     '@pdfme/ui',
  //     '@pdfme/schemas',
  //     '@pdfme/generator',
  //     '@pdfme/common',
  //   ],
  // },
  server: {
    allowedHosts: true,
    proxy: {
      // POC: routes /poc-api/* → http://localhost:3001/*
      "/poc-api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/poc-api/, ""),
      },
    },
  },
});
