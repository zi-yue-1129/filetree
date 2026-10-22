/**
 * Touch target audit of the phone layout (412x915 CSS px, touch, DPR 2, as
 * the Android app's WebView): for every key screen, every visible interactive
 * element is measured (box, hit-testable area through its centre, whether its
 * centre is tappable, visibility, nearest neighbour gap) and problems are
 * listed. Screens are captured as PNGs for a visual sanity check.
 *
 *   PERF_PYTHON=/path/to/venv/bin/python timeout 900 node perf/tap-audit.ts --out /tmp/tap-audit [--dist dir]
 *     [--themes dark,light] [--effects full,plain]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, type Browser, type Page } from 'playwright';
import { fakeAndroidBridge } from './lib/fakeAndroid.ts';
import { NATIVE_FILE_SIZE, emitNativeProgress, nativeUploadResponses, submitNativeUpload } from './lib/nativeUpload.ts';
import { startStack } from './lib/servers.ts';
import { formatTapTarget, measureTapTargets, tapTargetProblems, type TapTarget } from './lib/tapTargets.ts';

const PASSWORD = 'perf-password-123';

/** Phone viewport of the owner's device (CSS px). */
export const PHONE_VIEWPORT = { width: 412, height: 915 };

/** One audited screen. */
interface ScreenResult {
  /** Screen name. */
  screen: string;
  /** Measured targets. */
  targets: TapTarget[];
}

/** Options for opening an audit page. */
interface AuditPageOptions {
  theme: 'dark' | 'light';
  effects: string;
  /** Login response stored as session, or null for a logged-out visitor. */
  session: { token: string } | null;
  /** Simulate the Capacitor Android app. */
  native: boolean;
  /** Extra canned plugin responses for the simulated app. */
  nativeResponses?: Record<string, unknown>;
}

/**
 * Open a phone page with the given theme, effects and session.
 *
 * @param browser - Browser.
 * @param options - Page options.
 * @returns Page.
 */
async function openPhonePage(browser: Browser, options: AuditPageOptions): Promise<Page> {
  const context = await browser.newContext({
    viewport: PHONE_VIEWPORT,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    colorScheme: options.theme,
    locale: 'zh-TW',
  });
  await context.addInitScript(
    ({ theme, effects, session }) => {
      localStorage.setItem('filenexus-theme', theme);
      localStorage.setItem('filenexus-effects', effects);
      if (session) {
        localStorage.setItem('filenexus_token', session.token);
        localStorage.setItem('filenexus_user', JSON.stringify(session));
      }
    },
    { theme: options.theme, effects: options.effects, session: options.session },
  );
  if (options.native) {
    // Nothing may leave the machine (the app checks GitHub for updates); the
    // harness always serves the app from 127.0.0.1.
    await context.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
    await context.addInitScript(fakeAndroidBridge, { launchUrl: null, responses: options.nativeResponses });
  }
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  return page;
}

/** Recorder that measures a screen and saves its screenshot. */
type Capture = (screen: string, scope?: string | null) => Promise<void>;

/**
 * Landing page, pending lists, both drawers, help and shortcut pages.
 *
 * @param page - Phone page (logged in).
 * @param baseUrl - App URL.
 * @param workDir - Scratch directory for upload fixtures.
 * @param capture - Recorder.
 */
async function auditPublicScreens(page: Page, baseUrl: string, workDir: string, capture: Capture): Promise<void> {
  await page.goto(`${baseUrl}/`);
  await page.getByText('資料傳輸核心').waitFor();
  await capture('landing');
  await page.getByPlaceholder('輸入內容...').fill('觸控檢查筆記');
  await page.getByPlaceholder('輸入內容...').press('Enter');
  await page.getByText('待定筆記 (1)').waitFor();
  const files = ['tap-a.txt', 'tap-b.txt'].map((name) => {
    const filePath = path.join(workDir, name);
    writeFileSync(filePath, `content of ${name}`);
    return filePath;
  });
  await page.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(files);
  await page.getByText('待傳檔案 (2)').waitFor();
  await capture('landing-pending');

  await page.goto(`${baseUrl}/`);
  await page.getByText('資料傳輸核心').waitFor();
  await page.getByRole('button', { name: '功能選單' }).click();
  await capture('menu-drawer', 'aside:has(nav)');
  await page.goto(`${baseUrl}/`);
  await page.getByText('資料傳輸核心').waitFor();
  await page.getByRole('button', { name: '目錄' }).click();
  await capture('directory-drawer', 'aside:not(:has(nav))');

  await page.goto(`${baseUrl}/help`);
  await page.getByRole('heading').first().waitFor();
  await capture('help');
  await page.goto(`${baseUrl}/shortcut`);
  await page.getByRole('heading').first().waitFor();
  await capture('shortcut');
}

/**
 * Scroll the phone dashboard pane back to the top (the breadcrumb row hides
 * while scrolled down) and let the chrome transition finish.
 *
 * @param page - Phone page on a user dashboard.
 */
async function scrollDashboardToTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const scroller of document.querySelectorAll('[data-dashboard-scroller]')) scroller.scrollTop = 0;
  });
  await page.waitForTimeout(400);
}

/**
 * Dashboard of the logged-in owner: grid, folder, menus, dialogs, selection.
 *
 * @param page - Phone page (logged in).
 * @param baseUrl - App URL.
 * @param capture - Recorder.
 */
async function auditDashboard(page: Page, baseUrl: string, capture: Capture): Promise<void> {
  await page.goto(`${baseUrl}/perfuser`);
  await page.locator('.file-item').first().waitFor();
  await capture('dashboard');
  await scrollDashboardToTop(page);

  // Folder sidebar drawer (資料夾 button in the breadcrumbs bar).
  await page.getByRole('button', { name: '資料夾', exact: true }).click();
  await page.waitForTimeout(600);
  await capture('dashboard-folder-drawer', 'main div.absolute.z-40');
  await page.locator('main div.fixed.inset-0.z-30').click({ position: { x: 380, y: 400 } });
  await page.waitForTimeout(600);

  // Into a folder (breadcrumbs).
  await page.locator('.folder-card', { hasText: '專案 1' }).first().click();
  await page.getByRole('button', { name: /專案 1/ }).waitFor();
  await capture('dashboard-in-folder');
  // The capture scrolled cards into view, which hides the phone breadcrumb
  // row; scroll back up like a user would to reach it.
  await scrollDashboardToTop(page);
  await page.getByRole('button', { name: '所有檔案' }).click();
  await page.locator('.file-item').first().waitFor();

  // Row action menu of the first file.
  const firstFile = page.locator('.file-item[data-id^="file:"]').first();
  await firstFile.locator('button:has(svg.lucide-ellipsis-vertical)').click();
  await page.getByText('QR Code', { exact: true }).waitFor();
  await capture('file-menu', 'div[style*="z-index: 9999"]');
  await page.getByText('QR Code', { exact: true }).click();
  await page.getByText('掃描 QR Code').waitFor();
  await page.locator('svg[height="200"]').waitFor();
  await capture('qr-dialog', 'div.fixed.inset-0.z-60');
  await page.getByRole('button', { name: '關閉' }).click();

  // Inline rename.
  const renameTarget = page.locator('.file-item[data-id^="file:"]').nth(1);
  const renameId = await renameTarget.getAttribute('data-id');
  if (renameId === null) throw new Error('file card without data-id');
  await renameTarget.locator('button:has(svg.lucide-ellipsis-vertical)').click();
  await page.getByText('重命名', { exact: true }).click();
  await page.locator(`.file-item[data-id="${renameId}"] input`).waitFor();
  await capture('rename', `.file-item[data-id="${renameId}"]`);
  await page.locator(`.file-item[data-id="${renameId}"] input`).press('Escape');

  // Preview of an image (tap the thumbnail of a card with an <img>).
  const imageCard = page.locator('.file-item[data-id^="file:"]:has(img)').first();
  await imageCard.locator('img').click();
  await page.locator('div.fixed.inset-0.z-150').waitFor();
  await page.waitForTimeout(600);
  await capture('preview', 'div.fixed.inset-0.z-150');
  await page.keyboard.press('Escape');
  await page.goto(`${baseUrl}/perfuser`);
  await page.locator('.file-item').first().waitFor();

  // Folder card action menu.
  const folderCard = page.locator('.folder-card').first();
  await folderCard.locator('button:has(svg.lucide-ellipsis-vertical)').click();
  await page.waitForTimeout(400);
  await capture('folder-menu', 'div[style*="z-index: 9999"]');
  const folderId = await folderCard.getAttribute('data-id');
  if (folderId === null) throw new Error('folder card without data-id');
  await page.getByText('重命名', { exact: true }).click();
  await page.locator(`.folder-card[data-id="${folderId}"] input`).waitFor();
  await capture('folder-rename', `.folder-card[data-id="${folderId}"]`);
  await page.locator(`.folder-card[data-id="${folderId}"] input`).press('Escape');

  // Menu of a file card in the lower half of the screen.
  const menuButtons = page.locator('.file-item[data-id^="file:"] button:has(svg.lucide-ellipsis-vertical)');
  let lowMenuButton: ReturnType<Page['locator']> | null = null;
  for (let index = 0; index < (await menuButtons.count()) && lowMenuButton === null; index += 1) {
    const box = await menuButtons.nth(index).boundingBox();
    if (box && box.y + box.height / 2 > PHONE_VIEWPORT.height / 2 && box.y + box.height < PHONE_VIEWPORT.height) lowMenuButton = menuButtons.nth(index);
  }
  if (lowMenuButton === null) throw new Error('no file card menu button in the lower half of the screen');
  await lowMenuButton.click();
  await page.getByText('QR Code', { exact: true }).waitFor();
  await capture('file-menu-low', 'div[style*="z-index: 9999"]');
  // Close it with a tap outside the menu (a fixed point could land on one of
  // its items, e.g. QR Code, depending on where the card sits).
  const lowMenuBox = await page.locator('div[style*="z-index: 9999"]').boundingBox();
  if (lowMenuBox === null) throw new Error('the low file menu has no box');
  await page.mouse.click(5, lowMenuBox.y > 300 ? 250 : lowMenuBox.y + lowMenuBox.height + 60);
  await page.locator('div[style*="z-index: 9999"]').waitFor({ state: 'detached' });

  // Settings modal, then selection mode with the batch action bar.
  await page.locator('header button:has(svg.lucide-settings)').click();
  await page.getByRole('button', { name: '選擇檔案' }).waitFor();
  await capture('settings-modal', 'div.fixed.inset-0.z-50');
  await page.getByRole('button', { name: '選擇檔案' }).click();
  await page.locator('.file-item[data-id^="file:"]').first().locator('button').first().click();
  await page.waitForTimeout(600);
  await capture('selection-mode');
  await page.goto(`${baseUrl}/perfuser`);
  await page.locator('.file-item').first().waitFor();

  // Notes / links tab.
  // Phones switch content with the floating bottom tablist.
  await page.getByRole('tab', { name: '筆記' }).click();
  await page.waitForTimeout(800);
  await capture('urls-tab');
}

/**
 * Logged-out visitor: locked dashboard and the password dialog.
 *
 * @param page - Phone page without a session.
 * @param baseUrl - App URL.
 * @param capture - Recorder.
 */
async function auditLoggedOut(page: Page, baseUrl: string, capture: Capture): Promise<void> {
  await page.goto(`${baseUrl}/perfuser`);
  await page.locator('header button:has(svg.lucide-lock)').waitFor();
  await page.waitForTimeout(800);
  await capture('dashboard-locked');
  await page.locator('header button:has(svg.lucide-lock)').click();
  await page.getByText('身分驗證').waitFor();
  await capture('auth-modal', 'div.fixed.inset-0.z-50');
}

/**
 * Native-only settings page in the simulated Android app.
 *
 * @param page - Native phone page.
 * @param baseUrl - App URL.
 * @param capture - Recorder.
 */
async function auditNativeSettings(page: Page, baseUrl: string, capture: Capture): Promise<void> {
  await page.goto(`${baseUrl}/settings`);
  await page.getByRole('heading').first().waitFor();
  await page.waitForTimeout(800);
  await capture('native-settings');
  await page.getByRole('button', { name: '功能選單' }).click();
  await capture('native-menu-drawer', 'aside:has(nav)');
}

/**
 * Native landing page while a background upload is in flight (inline progress).
 *
 * @param page - Native phone page with a signed-in device.
 * @param baseUrl - App URL.
 * @param capture - Recorder.
 */
async function auditNativeUploadProgress(page: Page, baseUrl: string, capture: Capture): Promise<void> {
  await submitNativeUpload(page, baseUrl, PASSWORD);
  const progress = page.getByRole('region', { name: '上傳進度' });
  await progress.waitFor();
  await emitNativeProgress(page, 'uploading', NATIVE_FILE_SIZE / 2);
  await progress.scrollIntoViewIfNeeded();
  await capture('native-upload-progress');
}

/** Run the audit. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      dist: { type: 'string' },
      themes: { type: 'string', default: 'dark,light' },
      effects: { type: 'string', default: 'full,plain' },
      'backend-port': { type: 'string', default: '5296' },
      'preview-port': { type: 'string', default: '4296' },
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
  const workDir = path.join(tmpdir(), `fn-tap-audit-${process.pid}`);
  mkdirSync(workDir, { recursive: true });
  const problemLines: string[] = [];
  try {
    const body = new FormData();
    body.append('password', PASSWORD);
    const response = await fetch(`${stack.baseUrl}/api/login`, { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`login failed: HTTP ${response.status}`);
    const session = (await response.json()) as { token: string };
    for (const theme of values.themes.split(',') as Array<'dark' | 'light'>) {
      for (const effects of values.effects.split(',')) {
        const label = `${theme}-${effects}`;
        const directory = path.join(values.out, label);
        mkdirSync(directory, { recursive: true });
        const results: ScreenResult[] = [];
        const makeCapture = (page: Page): Capture => async (screen, scope = null) => {
          // Let entrance animations (drawers, dialogs, list items) settle.
          await page.waitForTimeout(700);
          await page.screenshot({ path: path.join(directory, `${screen}.png`) });
          const targets = await measureTapTargets(page, scope);
          results.push({ screen, targets });
          for (const target of targets) {
            if (tapTargetProblems(target).length > 0) problemLines.push(formatTapTarget(`${label}/${screen}`, target));
          }
        };
        const runs: Array<{ options: AuditPageOptions; audit: (page: Page, capture: Capture) => Promise<void> }> = [
          { options: { theme, effects, session, native: false }, audit: (page, capture) => auditPublicScreens(page, stack.baseUrl, workDir, capture) },
          { options: { theme, effects, session, native: false }, audit: (page, capture) => auditDashboard(page, stack.baseUrl, capture) },
          { options: { theme, effects, session: null, native: false }, audit: (page, capture) => auditLoggedOut(page, stack.baseUrl, capture) },
          { options: { theme, effects, session, native: true }, audit: (page, capture) => auditNativeSettings(page, stack.baseUrl, capture) },
          {
            options: { theme, effects, session, native: true, nativeResponses: nativeUploadResponses() },
            audit: (page, capture) => auditNativeUploadProgress(page, stack.baseUrl, capture),
          },
        ];
        for (const run of runs) {
          const page = await openPhonePage(browser, run.options);
          await run.audit(page, makeCapture(page));
          await page.context().close();
        }
        writeFileSync(path.join(directory, 'targets.json'), JSON.stringify(results, null, 2));
        const total = results.reduce((sum, result) => sum + result.targets.length, 0);
        const failing = results.reduce((sum, result) => sum + result.targets.filter((target) => tapTargetProblems(target).length > 0).length, 0);
        process.stdout.write(`${label}: ${results.length} screens, ${total} targets, ${failing} with problems\n`);
      }
    }
    writeFileSync(path.join(values.out, 'problems.txt'), `${problemLines.join('\n')}\n`);
    process.stdout.write(`problems written to ${path.join(values.out, 'problems.txt')} (${problemLines.length} lines)\n`);
  } finally {
    await browser.close();
    await stack.stop();
  }
}

await main();
