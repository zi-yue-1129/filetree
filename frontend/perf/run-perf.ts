/**
 * FileNexus frontend perf harness (Playwright + Chromium, low-end phone).
 *
 * Builds nothing itself: run `npm run build` first. Then, from `frontend/`:
 *
 *   PERF_PYTHON=/path/to/venv/bin/python \
 *     timeout 3600 node perf/run-perf.ts --label before --runs 3
 *
 * It seeds a fresh backend data dir (1 user, 600 files in 40 folders, 150
 * images, 80 notes), starts uvicorn + `vite preview`, emulates a 390x844
 * phone with 6x CPU throttling (hardwareConcurrency 4, deviceMemory 2), runs
 * the scenarios N times per theme, writes `perf/results/<label>.json` and
 * prints medians as markdown. Compare files with `node perf/compare.ts a.json b.json`.
 * `--dist <dir>` serves another build output (e.g. a baseline build) instead
 * of the configured `build.outDir`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import type { DeviceOptions, EffectsSetting } from './lib/page.ts';
import { renderComparison, type ResultFile, type RunTable } from './lib/report.ts';
import { startStack } from './lib/servers.ts';
import {
  dashboardScenario,
  landingScenario,
  selectScenario,
  uploadScenario,
  type Metrics,
  type ScenarioContext,
} from './scenarios.ts';

const SCENARIOS: Record<string, (context: ScenarioContext) => Promise<Metrics>> = {
  landing: landingScenario,
  dashboard: dashboardScenario,
  select: selectScenario,
  // Must run last: it uploads files, which grows the dashboard data set.
  upload: uploadScenario,
};
const PERF_USERNAME = 'perfuser';
const PERF_PASSWORD = 'perf-password-123';

/**
 * Log a progress line to stderr (stdout carries the markdown table).
 *
 * @param message - Text.
 */
function log(message: string): void {
  process.stderr.write(`[perf] ${message}\n`);
}

/**
 * Log in through the preview proxy.
 *
 * @param baseUrl - Preview base URL.
 * @returns Session token and the user object stored by the app.
 */
async function login(baseUrl: string): Promise<{ token: string; user: unknown }> {
  const body = new FormData();
  body.append('password', PERF_PASSWORD);
  const response = await fetch(`${baseUrl}/api/login`, { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`login failed: HTTP ${response.status}`);
  const user = (await response.json()) as { token: string };
  return { token: user.token, user };
}

/** Parse CLI options, run every scenario and persist the results. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      label: { type: 'string' },
      runs: { type: 'string', default: '3' },
      scenarios: { type: 'string', default: Object.keys(SCENARIOS).join(',') },
      themes: { type: 'string', default: 'dark,light' },
      effects: { type: 'string', default: 'auto' },
      cpu: { type: 'string', default: '6' },
      hw: { type: 'string', default: '4' },
      mem: { type: 'string', default: '2' },
      'slow-network': { type: 'boolean', default: false },
      desktop: { type: 'boolean', default: false },
      screenshots: { type: 'string' },
      'backend-port': { type: 'string', default: '5291' },
      'preview-port': { type: 'string', default: '4291' },
      dist: { type: 'string' },
    },
  });
  if (!values.label) throw new Error('--label is required');
  const effects = values.effects as EffectsSetting;
  if (!['auto', 'full', 'low', 'plain'].includes(effects)) throw new Error(`invalid --effects ${values.effects}`);
  const python = process.env.PERF_PYTHON;
  if (!python) throw new Error('Set PERF_PYTHON to the backend virtualenv python');
  const scenarioNames = values.scenarios.split(',');
  for (const name of scenarioNames) if (!(name in SCENARIOS)) throw new Error(`unknown scenario ${name}`);
  const themes = values.themes.split(',') as Array<'dark' | 'light'>;
  const runs = Number(values.runs);

  const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const stack = await startStack({
    python,
    repoRoot: path.resolve(frontendDir, '..'),
    frontendDir,
    backendPort: Number(values['backend-port']),
    previewPort: Number(values['preview-port']),
    distDir: values.dist ? path.resolve(values.dist) : null,
  });
  log(`stack up at ${stack.baseUrl} (data ${stack.dataDir})`);
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const table: RunTable = {};
  const result: ResultFile = {
    label: values.label,
    createdAt: new Date().toISOString(),
    options: { ...values, runs },
    runs: table,
  };
  const resultsDir = path.join(frontendDir, 'perf', 'results');
  mkdirSync(resultsDir, { recursive: true });
  const outPath = path.join(resultsDir, `${values.label}.json`);
  // Persist after every run so a late failure keeps the finished runs.
  const persist = (): void => writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  // Uploads grow the data set, so every other scenario runs first (all themes).
  const ordered = [
    ...scenarioNames.filter((name) => name !== 'upload'),
    ...scenarioNames.filter((name) => name === 'upload'),
  ];
  try {
    const auth = await login(stack.baseUrl);
    for (const name of ordered) {
      for (const theme of themes) {
        table[theme] ??= {};
        table[theme][name] = [];
        const device: DeviceOptions = {
          cpuThrottle: Number(values.cpu),
          hardwareConcurrency: Number(values.hw),
          deviceMemory: Number(values.mem),
          slowNetwork: values['slow-network'],
          theme,
          effects,
          viewport: values.desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 },
          mobile: !values.desktop,
        };
        for (let run = 0; run < runs; run += 1) {
          const started = Date.now();
          const metrics = await SCENARIOS[name]({
            browser,
            baseUrl: stack.baseUrl,
            device,
            auth,
            username: PERF_USERNAME,
            password: PERF_PASSWORD,
            workDir: path.join(tmpdir(), 'fnperf-work'),
            screenshotDir: values.screenshots && run === 0 ? path.join(values.screenshots, theme) : null,
          });
          table[theme][name].push(metrics);
          persist();
          log(`${theme}/${name} run ${run + 1}/${runs} done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
        }
      }
    }
  } finally {
    await browser.close();
    await stack.stop();
  }
  log(`wrote ${outPath}`);
  process.stdout.write(`${renderComparison([result])}\n`);
}

await main();
