/** Build the shared React app and the injected desktop bridge without editing it. */
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const desktopRoot = fileURLToPath(new URL('../', import.meta.url));
const frontendRoot = fileURLToPath(new URL('../../frontend/', import.meta.url));

/** Run npm with an inherited environment and a bounded execution time.
 * @param {string[]} args npm arguments.
 * @returns {void}
 */
function runNpm(args) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: desktopRoot,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
    timeout: 300_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Frontend npm command failed: ${result.status}`);
}

if (!process.env.VITE_API_BASE_URL) {
  throw new Error('VITE_API_BASE_URL is required: a packaged app has no backend at its local origin.');
}
const apiOrigin = new URL(process.env.VITE_API_BASE_URL);
if (!['https:', 'http:'].includes(apiOrigin.protocol) || apiOrigin.origin !== process.env.VITE_API_BASE_URL) {
  throw new Error('VITE_API_BASE_URL must be an HTTP(S) origin without a path or trailing slash.');
}
runNpm(['--prefix', frontendRoot, 'ci']);
runNpm(['--prefix', frontendRoot, 'run', 'build', '--', '--config', '../desktop/vite.config.mjs']);
await mkdir(new URL('../generated/', import.meta.url), { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('../src/bootstrap.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../generated/bootstrap.js', import.meta.url)),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
});
