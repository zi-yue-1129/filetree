/**
 * Capture visual-check screenshots (no throttling) of the landing page, the
 * dashboard and the uploader for every theme x effects x viewport combination.
 *
 *   PERF_PYTHON=/path/to/venv/bin/python timeout 600 node perf/screenshots.ts --out /tmp/shots [--dist dir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, type Page } from 'playwright';
import { startStack } from './lib/servers.ts';

const PASSWORD = 'perf-password-123';

/**
 * Print layout diagnostics of the dashboard list to stderr.
 *
 * @param page - Dashboard page.
 * @param label - Prefix for the log line.
 */
async function logDashboardLayout(page: Page, label: string): Promise<void> {
  const layout = await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="virtuoso-scroller"]');
    if (!scroller) throw new Error('virtuoso scroller missing');
    const rect = scroller.getBoundingClientRect();
    return {
      scrollerTop: Math.round(rect.top),
      scrollerHeight: Math.round(rect.height),
      scrollHeight: scroller.scrollHeight,
      renderedFiles: document.querySelectorAll('.file-item').length,
      renderedFolders: document.querySelectorAll('.folder-card').length,
      effects: document.documentElement.dataset.effects ?? '(none)',
    };
  });
  process.stderr.write(`[shots] ${label} ${JSON.stringify(layout)}\n`);
}

/** Start the stack and capture every combination. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      themes: { type: 'string', default: 'dark,light' },
      effects: { type: 'string', default: 'full,low' },
      'backend-port': { type: 'string', default: '5292' },
      'preview-port': { type: 'string', default: '4292' },
      dist: { type: 'string' },
    },
  });
  if (!values.out) throw new Error('--out is required');
  const python = process.env.PERF_PYTHON;
  if (!python) throw new Error('Set PERF_PYTHON to the backend virtualenv python');
  const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const stack = await startStack({
    python,
    repoRoot: path.resolve(frontendDir, '..'),
    frontendDir,
    backendPort: Number(values['backend-port']),
    previewPort: Number(values['preview-port']),
    distDir: values.dist ? path.resolve(values.dist) : null,
  });
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const body = new FormData();
    body.append('password', PASSWORD);
    const response = await fetch(`${stack.baseUrl}/api/login`, { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`login failed: HTTP ${response.status}`);
    const user = (await response.json()) as { token: string };
    const viewports = [
      { name: 'phone', viewport: { width: 390, height: 844 }, mobile: true },
      { name: 'desktop', viewport: { width: 1440, height: 900 }, mobile: false },
    ];
    for (const theme of values.themes.split(',')) {
      for (const effects of values.effects.split(',')) {
        for (const { name, viewport, mobile } of viewports) {
          const directory = path.join(values.out, `${theme}-${effects}`);
          mkdirSync(directory, { recursive: true });
          const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: theme as 'dark' | 'light' });
          await context.addInitScript(
            ({ selectedTheme, selectedEffects, session }) => {
              localStorage.setItem('filenexus-theme', selectedTheme);
              localStorage.setItem('filenexus-effects', selectedEffects);
              localStorage.setItem('filenexus_token', session.token);
              localStorage.setItem('filenexus_user', JSON.stringify(session));
            },
            { selectedTheme: theme, selectedEffects: effects, session: user },
          );
          const page = await context.newPage();
          await page.goto(`${stack.baseUrl}/`, { waitUntil: 'load' });
          await page.getByText('資料傳輸核心').waitFor();
          await page.waitForTimeout(1_500);
          await page.screenshot({ path: path.join(directory, `${name}-landing.png`) });
          await page.goto(`${stack.baseUrl}/perfuser`, { waitUntil: 'load' });
          await page.locator('.file-item').first().waitFor();
          await page.waitForTimeout(1_500);
          await logDashboardLayout(page, `${theme}/${effects}/${name}`);
          await page.screenshot({ path: path.join(directory, `${name}-dashboard.png`) });
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    await stack.stop();
  }
}

await main();
