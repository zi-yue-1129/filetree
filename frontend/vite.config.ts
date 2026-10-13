import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5168',
        changeOrigin: true,
        secure: false,
        ws: true,
      }
    }
  },
  build: {
    outDir: '../static/dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    // Generate manifest.json in outDir
    manifest: true,
    rollupOptions: {
      output: {
        // Only the stable React runtime gets a dedicated long-cache chunk.
        // Matching by path (not by bare specifier) also catches
        // `react-dom/client` and `scheduler`, which otherwise land in the
        // entry chunk and are re-downloaded on every app deploy.
        // framer-motion and lucide-react are intentionally left to Rollup:
        // forcing them into one eager chunk would pull the lazily loaded
        // animation features and every page's icons into the first load.
        manualChunks(id: string): string | undefined {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run[\\/]router)[\\/]/.test(id)) {
            return 'vendor-react';
          }
          return undefined;
        },
      }
    }
  },
})
