/**
 * Process management for the perf harness: seeds a throw-away backend data
 * directory, starts uvicorn on it and serves the production build with
 * `vite preview` (proxying `/api` and `/ws` to that backend, like production).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { preview, type PreviewServer } from 'vite';

/** Handles to everything started by {@link startStack}. */
export interface Stack {
  /** Base URL of the vite preview server (no trailing slash). */
  baseUrl: string;
  /** Seeded backend data directory. */
  dataDir: string;
  /** Stop every process. */
  stop: () => Promise<void>;
}

/** Options for {@link startStack}. */
export interface StackOptions {
  /** Python interpreter of the backend virtualenv. */
  python: string;
  /** Repository root (contains `backend/`). */
  repoRoot: string;
  /** Frontend directory (contains `vite.config.ts`). */
  frontendDir: string;
  /** Backend port. */
  backendPort: number;
  /** Preview port. */
  previewPort: number;
}

const SEED_TIMEOUT_MS = 300_000;
const BACKEND_START_TIMEOUT_MS = 60_000;

/**
 * Seed a new data directory and return the backend environment for it.
 *
 * @param options - Stack options.
 * @returns The data directory and the environment variables printed by the seeder.
 */
function seedBackend(options: StackOptions): { dataDir: string; env: Record<string, string> } {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'fnperf-'));
  const seedScript = path.join(options.frontendDir, 'perf', 'seed_backend.py');
  const result = spawnSync(options.python, [seedScript, dataDir], {
    encoding: 'utf-8',
    timeout: SEED_TIMEOUT_MS,
  });
  if (result.status !== 0) {
    throw new Error(`Seeding failed (status ${result.status}): ${result.stderr}`);
  }
  const lastLine = result.stdout.trim().split('\n').pop();
  if (!lastLine) throw new Error('Seeder printed nothing');
  const parsed = JSON.parse(lastLine) as { env: Record<string, string> };
  return { dataDir, env: parsed.env };
}

/**
 * Poll a URL until it answers 200 or the deadline passes.
 *
 * @param url - URL to poll.
 * @param timeoutMs - Deadline in milliseconds.
 */
async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error: unknown) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${url} not ready after ${timeoutMs} ms: ${String(lastError)}`);
}

/**
 * Stop a child process, escalating to SIGKILL after a grace period.
 *
 * @param child - Process to stop.
 */
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once('exit', () => resolve(true))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!exited) child.kill('SIGKILL');
}

/**
 * Seed data, start the backend and the preview server.
 *
 * @param options - Stack options.
 * @returns Running stack.
 */
export async function startStack(options: StackOptions): Promise<Stack> {
  const { dataDir, env } = seedBackend(options);
  const backend = spawn(
    options.python,
    ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', String(options.backendPort), '--log-level', 'warning'],
    {
      cwd: dataDir,
      env: { ...process.env, ...env, PYTHONPATH: options.repoRoot },
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
  const backendUrl = `http://127.0.0.1:${options.backendPort}`;
  let server: PreviewServer | null = null;
  try {
    await waitForHttp(`${backendUrl}/api/init`, BACKEND_START_TIMEOUT_MS);
    server = await preview({
      root: options.frontendDir,
      configFile: path.join(options.frontendDir, 'vite.config.ts'),
      logLevel: 'warn',
      preview: {
        host: '127.0.0.1',
        port: options.previewPort,
        strictPort: true,
        proxy: {
          '/api': { target: backendUrl, changeOrigin: true, ws: true },
          '/ws': { target: backendUrl, changeOrigin: true, ws: true },
        },
      },
    });
  } catch (error: unknown) {
    await stopChild(backend);
    throw error;
  }
  const previewServer = server;
  return {
    baseUrl: `http://127.0.0.1:${options.previewPort}`,
    dataDir,
    stop: async () => {
      await previewServer.close();
      await stopChild(backend);
    },
  };
}
