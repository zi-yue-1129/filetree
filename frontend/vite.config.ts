import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Relative og:image path as written in index.html (file lives in public/). */
const OG_IMAGE_PATH = '/og-card.jpg'

/**
 * Validate and normalise the public site origin used for social previews.
 *
 * @param rawSiteUrl Value of VITE_SITE_URL (e.g. "https://99.spkuan.cc").
 * @returns The origin without a trailing slash.
 * @throws Error if the value is not an absolute http(s) URL.
 */
function normaliseSiteUrl(rawSiteUrl: string): string {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(rawSiteUrl)
  } catch (error: unknown) {
    throw new Error(`VITE_SITE_URL is not a valid absolute URL: "${rawSiteUrl}"`, { cause: error })
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error(`VITE_SITE_URL must use http(s), got "${rawSiteUrl}"`)
  }
  return parsedUrl.href.replace(/\/+$/, '')
}

/**
 * Make Open Graph metadata absolute at build time.
 *
 * Link-preview crawlers (LINE, Discord, Facebook) ignore relative og:image
 * URLs. When VITE_SITE_URL is set (Cloudflare Pages), og:image is rewritten
 * to an absolute URL and og:url is added. When unset (local dev, the FastAPI
 * SPA fallback, Capacitor/Tauri bundles) index.html is left untouched.
 *
 * @param rawSiteUrl Value of VITE_SITE_URL, or undefined when not configured.
 * @returns A Vite plugin transforming index.html.
 */
function socialMetaPlugin(rawSiteUrl: string | undefined): Plugin {
  return {
    name: 'filenexus-social-meta',
    transformIndexHtml(html: string): string {
      if (!rawSiteUrl) {
        return html
      }
      const siteUrl = normaliseSiteUrl(rawSiteUrl)
      const relativeImageAttr = `content="${OG_IMAGE_PATH}"`
      if (!html.includes(relativeImageAttr)) {
        throw new Error(`index.html has no og:image with ${relativeImageAttr}; update OG_IMAGE_PATH`)
      }
      return html
        .replace(relativeImageAttr, `content="${siteUrl}${OG_IMAGE_PATH}"`)
        .replace(
          '<meta property="og:type"',
          `<meta property="og:url" content="${siteUrl}/" />\n    <meta property="og:type"`,
        )
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // loadEnv merges .env files with process.env (which wins), so Pages build
  // variables are picked up without a .env file.
  const env: Record<string, string> = loadEnv(mode, process.cwd(), 'VITE_')
  const siteUrl: string | undefined = env.VITE_SITE_URL || undefined

  return {
    plugins: [
      react(),
      tailwindcss(),
      socialMetaPlugin(siteUrl),
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
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-ui': ['framer-motion', 'lucide-react'],
          }
        }
      }
    },
  }
})
