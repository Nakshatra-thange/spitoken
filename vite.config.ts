import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Solana web3.js needs this
    "global": "globalThis",
  },
  optimizeDeps: {
    include: ["@solana/web3.js"],
  },
})
