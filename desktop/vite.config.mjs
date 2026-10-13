/** Reuse the web build and add a synchronous, native-only server origin override. */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const requireFrontend = createRequire(new URL('../frontend/package.json', import.meta.url));
const { mergeConfig } = await import(pathToFileURL(requireFrontend.resolve('vite')).href);
// Vite loads this TypeScript import while bundling the configuration.
const { default: sharedConfig } = await import('../frontend/vite.config.ts');

export default mergeConfig(sharedConfig, {
  root: fileURLToPath(new URL('../frontend/', import.meta.url)),
  plugins: [{
    name: 'filenexus-desktop-origin',
    enforce: 'pre',
    /** Apply the API override before Vite removes TypeScript annotations.
     * @param {string} source Original module source.
     * @param {string} id Resolved module path.
     * @returns {string | null} Transformed source or no change.
     */
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/services/api.ts')) return null;
      const original = 'import.meta.env.VITE_API_BASE_URL || window.location.origin';
      if (!source.includes(original)) throw new Error('Shared API origin contract changed; review desktop override.');
      return source.replace(original,
        "(('__TAURI_INTERNALS__' in window) && (window as Window & { __FILENEXUS_SERVER_URL__?: string }).__FILENEXUS_SERVER_URL__) || " + original);
    },
  }],
});
