/**
 * Screenshots of the user page layout (phone 412x915 and desktop 1440x900).
 *
 *   PERF_PYTHON=... timeout 600 node perf/layout-shots.ts --out <dir> [--desktop-only] [--prefix before-]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, type Browser, type Page } from 'playwright';
import { startStack } from './lib/servers.ts';

const PASSWORD = 'perf-password-123';

/**
 * Open a logged-in page.
 *
 * @param browser - Browser.
 * @param mobile - Phone viewport.
 * @param theme - Theme.
 * @param effects - Effects level.
 * @param session - Login response stored as the app session (null: anonymous visitor).
 * @returns Page.
 */
async function openPage(browser: Browser, mobile: boolean, theme: string, effects: string, session: { token: string } | null): Promise<Page> {
  const context = await browser.newContext({
    viewport: mobile ? { width: 412, height: 915 } : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
  });
  await context.addInitScript(({ selectedTheme, selectedEffects, user }) => {
    localStorage.setItem('filenexus-theme', selectedTheme);
    localStorage.setItem('filenexus-effects', selectedEffects);
    if (user === null) return;
    localStorage.setItem('filenexus_token', user.token);
    localStorage.setItem('filenexus_user', JSON.stringify(user));
  }, { selectedTheme: theme, selectedEffects: effects, user: session });
  return context.newPage();
}

/**
 * Scroll the dashboard pane in finger-like steps.
 *
 * @param page - Page.
 * @param deltaY - Distance in CSS px.
 */
async function scrollPane(page: Page, deltaY: number): Promise<void> {
  await page.evaluate(async (distance) => {
    const scroller = document.querySelector('[data-dashboard-scroller]');
    if (!scroller) throw new Error('no dashboard scroller');
    for (let step = 0; step < 8; step += 1) {
      scroller.scrollTop += distance / 8;
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
  }, deltaY);
  await page.waitForTimeout(800);
}

/** Take every screenshot. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      prefix: { type: 'string', default: '' },
      'desktop-only': { type: 'boolean', default: false },
    },
  });
  const python = process.env.PERF_PYTHON;
  if (!python || !values.out) throw new Error('Set PERF_PYTHON and --out');
  const outDir = path.resolve(values.out);
  mkdirSync(outDir, { recursive: true });
  const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const stack = await startStack({ python, repoRoot: path.resolve(frontendDir, '..'), frontendDir, backendPort: 5295, previewPort: 4295 });
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const shot = async (page: Page, name: string): Promise<void> => {
    const file = path.join(outDir, `${values.prefix}${name}.png`);
    await page.screenshot({ path: file });
    process.stdout.write(`${file}\n`);
  };
  try {
    const body = new FormData();
    body.append('password', PASSWORD);
    const response = await fetch(`${stack.baseUrl}/api/login`, { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`login failed: HTTP ${response.status}`);
    const session = (await response.json()) as { token: string };

    const desktop = await openPage(browser, false, 'dark', 'full', null);
    await desktop.goto(`${stack.baseUrl}/perfuser`);
    await desktop.locator('.file-item').first().waitFor();
    await desktop.waitForTimeout(2500);
    await shot(desktop, 'desktop-dark-full');
    await desktop.context().close();
    if (values['desktop-only']) return;

    for (const theme of ['dark', 'light']) {
      for (const effects of ['full', 'plain']) {
        const label = `phone-${theme}-${effects}`;
        const page = await openPage(browser, true, theme, effects, session);
        await page.goto(`${stack.baseUrl}/perfuser`);
        await page.locator('.file-item').first().waitFor();
        await page.waitForTimeout(2000);
        await shot(page, `${label}-top`);
        await scrollPane(page, 500);
        await shot(page, `${label}-scrolled-down`);
        await scrollPane(page, -120);
        await shot(page, `${label}-scrolled-up`);
        await page.getByRole('tab', { name: '筆記' }).click();
        await page.locator('[data-id^="url:"]').first().waitFor();
        await page.waitForTimeout(1000);
        await shot(page, `${label}-notes`);
        await page.getByRole('tab', { name: '檔案' }).click();
        await page.locator('.file-item').first().waitFor();
        await page.locator('header button:has(svg.lucide-settings)').click();
        await page.getByRole('button', { name: '選擇檔案' }).click();
        await page.locator('.file-item[data-id^="file:"]').first().locator('button').first().click();
        await page.waitForTimeout(800);
        await shot(page, `${label}-selection`);
        await page.context().close();
      }
    }
  } finally {
    await browser.close();
    await stack.stop();
  }
}

await main();
