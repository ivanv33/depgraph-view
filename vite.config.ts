import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'src/view',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (asset) => (asset.names.some((n) => n.endsWith('.css')) ? 'viewer.css' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
})
