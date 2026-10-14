/**
 * Functional smoke test of the flows touched by the perf work (unthrottled):
 * uploader add/remove, notes, effects toggle, dashboard folder navigation,
 * selection, rename and the lazily loaded QR dialog — on a phone viewport and
 * on desktop, in full, low-power and plain mode.
 *
 *   PERF_PYTHON=/path/to/venv/bin/python timeout 600 node perf/functional-check.ts [--dist dir]
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, type Browser, type Page } from 'playwright';
import { startStack } from './lib/servers.ts';

const PASSWORD = 'perf-password-123';

/**
 * Fail with a descriptive error.
 *
 * @param condition - Must be true.
 * @param message - Error message.
 */
function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`);
}

/**
 * Open a page with the given viewport, effects preference and session.
 *
 * @param browser - Browser.
 * @param mobile - Phone (390x844, touch) or desktop (1440x900).
 * @param effects - Stored effects preference.
 * @param session - Login response stored as the app session.
 * @returns Page.
 */
async function openPage(browser: Browser, mobile: boolean, effects: string, session: { token: string }): Promise<Page> {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
  });
  await context.addInitScript(
    ({ selectedEffects, user }) => {
      localStorage.setItem('filenexus-theme', 'dark');
      // Only on the first load, so toggling the preference survives reloads.
      if (!sessionStorage.getItem('fncheck-initialised')) {
        localStorage.setItem('filenexus-effects', selectedEffects);
        sessionStorage.setItem('fncheck-initialised', '1');
      }
      localStorage.setItem('filenexus_token', user.token);
      localStorage.setItem('filenexus_user', JSON.stringify(user));
    },
    { selectedEffects: effects, user: session },
  );
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    throw new Error(`page error: ${error.message}`);
  });
  return page;
}

/**
 * Landing page: notes, add/remove files, uploader readiness.
 *
 * @param page - Page.
 * @param baseUrl - App URL.
 * @param workDir - Scratch directory.
 */
async function checkLanding(page: Page, baseUrl: string, workDir: string): Promise<void> {
  await page.goto(`${baseUrl}/`);
  await page.getByText('資料傳輸核心').waitFor();
  await page.getByPlaceholder('輸入內容...').fill('功能檢查筆記');
  await page.getByPlaceholder('輸入內容...').press('Enter');
  await page.getByText('待定筆記 (1)').waitFor();
  const files = ['a.txt', 'b.txt'].map((name) => {
    const filePath = path.join(workDir, name);
    writeFileSync(filePath, `content of ${name}`);
    return filePath;
  });
  await page.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(files);
  await page.getByText('待傳檔案 (2)').waitFor();
  await page.locator('p', { hasText: 'a.txt' }).locator('xpath=following-sibling::button').click();
  await page.getByText('待傳檔案 (1)').waitFor();
}

/**
 * Phone: the first visit to a user page through the 其他人 drawer must close
 * the drawer completely. Regression for the "fogged page on first open" bug:
 * the UserPage chunk was not loaded yet, so the navigation suspended the
 * Suspense boundary around the whole layout while the drawer backdrop played
 * its exit animation; the hidden backdrop never finished exiting and stayed
 * over the page (blurred, dimmed, swallowing every tap).
 *
 * Must run on a fresh page that has not loaded the UserPage chunk yet.
 *
 * @param page - Phone page.
 * @param baseUrl - App URL.
 */
async function checkDirectoryFirstNavigation(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/`);
  await page.getByText('資料傳輸核心').waitFor();
  await page.getByRole('button', { name: '目錄' }).click();
  await page.locator('aside').getByText('perfuser').click();
  await page.locator('.file-item').first().waitFor();
  const backdrop = page.locator('div.fixed.inset-0.z-40');
  // Exit animations take ~0.3 s; give them generous time before judging.
  await backdrop.waitFor({ state: 'detached', timeout: 5_000 }).catch((error: unknown) => {
    throw new Error(`CHECK FAILED: drawer backdrop still covers the page after navigating (${String(error)})`);
  });
  // A tap in the middle of the page must reach the dashboard, not a backdrop.
  const hitInsideMain = await page.evaluate(() => {
    const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return hit !== null && hit.closest('main') !== null;
  });
  check(hitInsideMain, 'a tap in the page centre must reach the dashboard');
}

/**
 * Dashboard: folder navigation, selection, rename, QR dialog.
 *
 * @param page - Page.
 * @param baseUrl - App URL.
 * @param mobile - Phone layout.
 * @param session - Login response (token for API verification).
 */
async function checkDashboard(page: Page, baseUrl: string, mobile: boolean, session: { token: string }): Promise<void> {
  await page.goto(`${baseUrl}/perfuser`);
  await page.locator('.file-item').first().waitFor();
  // Folder navigation (folder cards are the virtual list header).
  // Phones open a folder on tap, desktop on double click.
  const folderCard = page.locator('.folder-card', { hasText: '專案 1' }).first();
  // Desktop double clicks the top strip: the card centre sits within 1px of
  // the hover overlay's Download button, so a centre click is a coin flip.
  if (mobile) await folderCard.click();
  else await folderCard.dblclick({ position: { x: 90, y: 12 } });
  await page.getByRole('button', { name: /專案 1/ }).waitFor();
  await page.getByRole('button', { name: '所有檔案' }).click();
  await page.locator('.file-item').first().waitFor();

  // Selection of two files.
  if (mobile) {
    await page.locator('header button:has(svg.lucide-settings)').click();
    await page.getByRole('button', { name: '選擇檔案' }).click();
  }
  const first = page.locator('.file-item[data-id^="file:"]').nth(0);
  const second = page.locator('.file-item[data-id^="file:"]').nth(1);
  // Phones tick the checkbox (selection mode); desktop selects on card click.
  const toggleCard = async (card: typeof first): Promise<void> => {
    if (mobile) {
      await card.locator('button').first().click();
      return;
    }
    // Click the info strip: the hover overlay's action buttons cover the
    // middle of the thumbnail on desktop.
    const box = await card.boundingBox();
    if (!box) throw new Error('file card not visible');
    await card.click({ position: { x: 12, y: box.height - 12 } });
  };
  await toggleCard(first);
  await toggleCard(second);
  const checked = await page.locator('.file-item[data-id^="file:"] svg.lucide-square-check-big, .file-item[data-id^="file:"] svg.lucide-check-square').count();
  check(checked === 2, `expected 2 selected files, saw ${checked}`);
  if (mobile) {
    await page.getByRole('button', { name: '全選' }).waitFor();
    await page.locator('button:has(svg.lucide-x)').first().click();
  } else {
    await toggleCard(first);
    await toggleCard(second);
  }
  const remaining = await page.locator('.file-item[data-id^="file:"] svg.lucide-square-check-big, .file-item[data-id^="file:"] svg.lucide-check-square').count();
  check(remaining === 0, `expected selection cleared, saw ${remaining}`);

  // Rename the second rendered file via the row menu (phone) or the hover
  // action (desktop). Renamed files sort to the end of the (virtual) list, so
  // the result is verified through the API instead of the DOM.
  const targetId = await page.locator('.file-item[data-id^="file:"]').nth(1).getAttribute('data-id');
  check(targetId !== null, 'second file card has no data-id');
  const oldName = targetId.slice('file:'.length);
  const newName = `renamed_${Date.now()}_${oldName}`;
  const target = page.locator(`.file-item[data-id="${targetId}"]`);
  if (mobile) {
    await target.locator('button:has(svg.lucide-ellipsis-vertical)').click();
    await page.getByText('重命名', { exact: true }).click();
  } else {
    await target.hover();
    await target.locator('button[title="重命名項目"]').click();
  }
  const input = target.locator('input');
  await input.fill(newName);
  await input.press('Enter');
  await page.locator(`.file-item[data-id="${targetId}"]`).waitFor({ state: 'detached' });
  const names = await listFileNames(baseUrl, session.token);
  check(names.includes(newName) && !names.includes(oldName), `rename ${oldName} -> ${newName} not persisted`);

  // QR code dialog (lazy-loaded renderer) for the third rendered file.
  const qrTarget = page.locator('.file-item[data-id^="file:"]').nth(2);
  if (mobile) {
    await qrTarget.locator('button:has(svg.lucide-ellipsis-vertical)').click();
    await page.getByText('QR Code', { exact: true }).click();
  } else {
    await qrTarget.hover();
    await qrTarget.locator('button[title="QR Code"]').click();
  }
  await page.getByText('掃描 QR Code').waitFor();
  await page.locator('svg[height="200"]').waitFor();
  await page.getByRole('button', { name: '關閉' }).click();
}

/**
 * List the perf user's file names through the API.
 *
 * @param baseUrl - App URL.
 * @param token - Session token.
 * @returns File names.
 */
async function listFileNames(baseUrl: string, token: string): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/user/perfuser`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`dashboard fetch failed: HTTP ${response.status}`);
  const data = (await response.json()) as { files: Array<{ name: string }> };
  return data.files.map((file) => file.name);
}

/**
 * Effects toggle cycles auto → low → full → plain → auto and drives data-effects.
 *
 * @param page - Desktop page on the landing route.
 */
async function checkEffectsToggle(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /視覺效果/ });
  const state = async (): Promise<{ stored: string | null; applied: string | undefined }> =>
    page.evaluate(() => ({ stored: localStorage.getItem('filenexus-effects'), applied: document.documentElement.dataset.effects }));
  await page.evaluate(() => localStorage.removeItem('filenexus-effects'));
  await page.reload();
  await toggle.waitFor();
  check((await toggle.textContent())?.includes('自動') === true, 'toggle should start at 自動');
  await toggle.click();
  let current = await state();
  check(current.stored === 'low' && current.applied === 'low', `after 1 click: ${JSON.stringify(current)}`);
  const backdrop = await page.evaluate(() => getComputedStyle(document.querySelector('.glass-card-premium') as Element).backdropFilter);
  check(backdrop === 'none', `low-power mode must disable backdrop-filter, got ${backdrop}`);
  await toggle.click();
  current = await state();
  check(current.stored === 'full' && current.applied === 'full', `after 2 clicks: ${JSON.stringify(current)}`);
  await toggle.click();
  current = await state();
  check(current.stored === 'plain' && current.applied === 'plain', `after 3 clicks: ${JSON.stringify(current)}`);
  check((await toggle.textContent())?.includes('極簡') === true, 'third click should select 極簡');
  check((await page.locator('canvas').count()) === 0, 'plain mode must unmount the canvas background');
  await toggle.click();
  current = await state();
  check(current.stored === null, `after 4 clicks: ${JSON.stringify(current)}`);
}

/** Background canvas modules that plain mode must never download. */
const BACKGROUND_CHUNK_PATTERN = /\/(Starfield|AuraField)[-.][^/]*\.js$/;

/**
 * Plain mode: no canvas background (module not even requested), no
 * backdrop-filter, no infinite animations, decorative glows hidden.
 *
 * @param page - Page currently showing the landing route in plain mode.
 * @param requestedUrls - Every URL the page requested so far.
 */
async function checkPlainMode(page: Page, requestedUrls: string[]): Promise<void> {
  const applied = await page.evaluate(() => document.documentElement.dataset.effects);
  check(applied === 'plain', `plain mode must set data-effects=plain, got ${applied}`);
  check((await page.locator('canvas').count()) === 0, 'plain mode must not render a canvas background');
  const backgroundChunks = requestedUrls.filter((url) => BACKGROUND_CHUNK_PATTERN.test(url));
  check(backgroundChunks.length === 0, `plain mode must not download the background: ${backgroundChunks.join(', ')}`);
  const styles = await page.evaluate(() => {
    const glass = document.querySelector('.glass-card-premium');
    const glow = document.querySelector('.fx-glow');
    const pulse = document.querySelector('.animate-pulse, .animate-spin-slow');
    return {
      backdrop: glass ? getComputedStyle(glass).backdropFilter : null,
      glow: glow ? getComputedStyle(glow).display : null,
      animation: pulse ? getComputedStyle(pulse).animationName : null,
      noise: getComputedStyle(document.body, '::before').backgroundImage,
    };
  });
  check(styles.backdrop === null || styles.backdrop === 'none', `plain: backdrop-filter ${styles.backdrop}`);
  check(styles.glow === null || styles.glow === 'none', `plain: decorative glow display ${styles.glow}`);
  check(styles.animation === null || styles.animation === 'none', `plain: infinite animation ${styles.animation}`);
  check(styles.noise === 'none', `plain: noise texture ${styles.noise}`);
}

/** Run every check. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dist: { type: 'string' },
      'backend-port': { type: 'string', default: '5294' },
      'preview-port': { type: 'string', default: '4294' },
    },
  });
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
  const workDir = mkdtempSync(path.join(tmpdir(), 'fncheck-'));
  try {
    const body = new FormData();
    body.append('password', PASSWORD);
    const response = await fetch(`${stack.baseUrl}/api/login`, { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`login failed: HTTP ${response.status}`);
    const session = (await response.json()) as { token: string };
    for (const mobile of [true, false]) {
      for (const effects of ['full', 'low', 'plain']) {
        const label = `${mobile ? 'phone' : 'desktop'}/${effects}`;
        const page = await openPage(browser, mobile, effects, session);
        const requestedUrls: string[] = [];
        page.on('request', (request) => requestedUrls.push(request.url()));
        // First, while the UserPage chunk is still unloaded (fresh page).
        if (mobile) await checkDirectoryFirstNavigation(page, stack.baseUrl);
        await checkLanding(page, stack.baseUrl, workDir);
        if (effects === 'plain') await checkPlainMode(page, requestedUrls);
        await checkDashboard(page, stack.baseUrl, mobile, session);
        if (!mobile && effects === 'full') {
          await page.goto(`${stack.baseUrl}/`);
          await checkEffectsToggle(page);
        }
        await page.context().close();
        process.stdout.write(`ok ${label}\n`);
      }
    }
  } finally {
    await browser.close();
    await stack.stop();
  }
}

await main();
