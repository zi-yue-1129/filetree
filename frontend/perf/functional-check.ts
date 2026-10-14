/**
 * Functional smoke test of the flows touched by the perf work (unthrottled):
 * uploader add/remove, notes, effects toggle, dashboard folder navigation,
 * selection, rename and the lazily loaded QR dialog — on a phone viewport and
 * on desktop, in full, low-power and plain mode. Finally, in a simulated
 * Capacitor Android app: copied share links and App Link routing.
 *
 * The build must set VITE_SITE_URL (the native link checks read it back from
 * index.html), e.g. `VITE_SITE_URL=https://links.example.test npm run build`.
 *
 *   PERF_PYTHON=/path/to/venv/bin/python timeout 600 node perf/functional-check.ts [--dist dir] [--native-only]
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
 * Phone: the navigation menu (left) and the user directory (right) are
 * mutually exclusive drawers. Opening one must close the other; before, both
 * could be open at once, stacking two backdrops and overlapping panels.
 *
 * @param page - Phone page.
 * @param baseUrl - App URL.
 */
async function checkExclusiveDrawers(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/`);
  await page.getByText('資料傳輸核心').waitFor();
  const backdrops = page.locator('div.fixed.inset-0.backdrop-blur-sm');
  await page.getByRole('button', { name: '功能選單' }).click();
  await backdrops.first().waitFor();
  await page.getByRole('button', { name: '目錄' }).click();
  // Let the closing drawer's exit animation finish.
  await page.waitForTimeout(800);
  const openBackdrops = await backdrops.count();
  check(openBackdrops === 1, `opening the directory must close the menu, found ${openBackdrops} drawer backdrops`);
  await page.getByRole('button', { name: '功能選單' }).click();
  await page.waitForTimeout(800);
  const afterSwitchBack = await backdrops.count();
  check(afterSwitchBack === 1, `opening the menu must close the directory, found ${afterSwitchBack} drawer backdrops`);
}

/**
 * The "FileNexus - Secure File Bridge Hub" footer was removed: on phones it
 * covered form fields above the on-screen keyboard and added nothing.
 *
 * @param page - Page on the landing route.
 */
async function checkNoBrandFooter(page: Page): Promise<void> {
  const footerCount = await page.getByText('Secure File Bridge Hub').count();
  check(footerCount === 0, `brand footer must be removed, found ${footerCount}`);
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

/**
 * Read the public site origin the build was made with (`VITE_SITE_URL`),
 * which the build writes into index.html as `og:url`.
 *
 * @param baseUrl - App URL.
 * @returns Site origin without trailing slash.
 * @throws Error when the build has no `og:url` (built without VITE_SITE_URL).
 */
async function readBuildSiteOrigin(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`index.html fetch failed: HTTP ${response.status}`);
  const match = /<meta property="og:url" content="([^"]+)"/.exec(await response.text());
  if (!match) {
    throw new Error('The build has no og:url: build with VITE_SITE_URL=https://<site> for the native link checks');
  }
  return new URL(match[1]).origin;
}

/** Options of the simulated Capacitor Android bridge. */
interface FakeAndroidOptions {
  /** URL returned by `App.getLaunchUrl()` (the App Link that started the app), or null. */
  launchUrl: string | null;
}

/**
 * Install a fake Capacitor Android bridge before any app script runs:
 * `Capacitor.getPlatform()` reports `android`, plugin calls resolve with
 * canned values (unknown ones reject as on a device without the plugin) and
 * `window.__fnFireNativeEvent(plugin, event, data)` emits a plugin event.
 * The clipboard is replaced by a recorder (`window.__fnClipboard`).
 *
 * @param options - Bridge options (serialised into the page).
 */
function fakeAndroidBridge(options: FakeAndroidOptions): void {
  type Callback = (data: unknown, error?: unknown) => void;
  const listeners = new Map<string, Callback[]>();
  const pluginMethods: Record<string, string[]> = {
    App: ['getLaunchUrl', 'getInfo', 'getState', 'removeListener', 'removeAllListeners'],
    Preferences: ['get', 'set', 'remove', 'keys', 'clear'],
    CapacitorUpdater: ['notifyAppReady', 'list', 'current'],
    FileNexusNative: ['getConfiguration', 'getSharedItems', 'getNativeInfo', 'getUploads', 'removeListener', 'removeAllListeners'],
    Device: ['getInfo', 'getId'],
  };
  const responses: Record<string, unknown> = {
    // Capacitor resolves `{}` when the app was not started by a link.
    'App.getLaunchUrl': options.launchUrl === null ? {} : { url: options.launchUrl },
    'App.getInfo': { version: '0.0.1', build: '1', id: 'cc.spkuan.filenexus', name: 'FileNexus' },
    'Preferences.get': { value: null },
    'CapacitorUpdater.list': { bundles: [] },
    'FileNexusNative.getConfiguration': { serverUrl: null, deviceToken: null, deviceId: null, deviceName: null },
    'FileNexusNative.getSharedItems': { items: [] },
    'FileNexusNative.getUploads': { uploads: [] },
  };
  let nextCallbackId = 0;
  const win = window as unknown as Record<string, unknown>;
  win.androidBridge = { postMessage: (): void => undefined };
  win.Capacitor = {
    PluginHeaders: Object.entries(pluginMethods).map(([name, methods]) => ({
      name,
      methods: [
        ...methods.map((method) => ({ name: method, rtype: 'promise' })),
        { name: 'addListener', rtype: 'callback' },
      ],
    })),
    nativePromise: async (plugin: string, method: string): Promise<unknown> => {
      const key = `${plugin}.${method}`;
      return key in responses ? responses[key] : {};
    },
    nativeCallback: (plugin: string, method: string, callOptions: { eventName?: string }, callback: Callback): string => {
      if (method !== 'addListener' || !callOptions.eventName) {
        throw new Error(`fake bridge: unexpected callback method ${plugin}.${method}`);
      }
      const key = `${plugin}:${callOptions.eventName}`;
      listeners.set(key, [...(listeners.get(key) ?? []), callback]);
      nextCallbackId += 1;
      return String(nextCallbackId);
    },
  };
  win.__fnFireNativeEvent = (plugin: string, eventName: string, data: unknown): number => {
    const callbacks = listeners.get(`${plugin}:${eventName}`) ?? [];
    callbacks.forEach((callback) => callback(data));
    return callbacks.length;
  };
  const clipboardTexts: string[] = [];
  win.__fnClipboard = clipboardTexts;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string): Promise<void> => {
        clipboardTexts.push(text);
      },
      write: async (items: ClipboardItem[]): Promise<void> => {
        for (const item of items) {
          clipboardTexts.push(await (await item.getType('text/plain')).text());
        }
      },
    },
  });
}

/** A page in the simulated Android app plus helpers to inspect it. */
interface NativePage {
  /** The page. */
  page: Page;
  /** Messages of every alert/confirm shown so far (all accepted). */
  dialogs: string[];
  /** Texts written to the clipboard so far. */
  clipboard: () => Promise<string[]>;
  /** Current path + query + hash. */
  currentLocation: () => Promise<string>;
  /** Emit `App.appUrlOpen` with the given URL; returns the listener count. */
  openAppLink: (url: string) => Promise<number>;
}

/**
 * Open a desktop-sized page running as the (simulated) Capacitor Android app.
 *
 * @param browser - Browser.
 * @param baseUrl - App URL (stands in for the WebView origin).
 * @param session - Login response stored as the app session.
 * @param launchUrl - App Link that "started" the app, or null.
 * @returns The page and its helpers.
 */
async function openNativePage(browser: Browser, baseUrl: string, session: { token: string }, launchUrl: string | null): Promise<NativePage> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Nothing may leave the machine (the app checks GitHub for updates).
  const appHost = new URL(baseUrl).hostname;
  await context.route((url) => url.hostname !== appHost, (route) => route.abort());
  await context.addInitScript(
    ({ user }) => {
      localStorage.setItem('filenexus-theme', 'dark');
      localStorage.setItem('filenexus-effects', 'plain');
      localStorage.setItem('filenexus_token', user.token);
      localStorage.setItem('filenexus_user', JSON.stringify(user));
    },
    { user: session },
  );
  await context.addInitScript(fakeAndroidBridge, { launchUrl });
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    throw new Error(`page error: ${error.message}`);
  });
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.accept();
  });
  return {
    page,
    dialogs,
    clipboard: async () => page.evaluate(() => [...(window as unknown as { __fnClipboard: string[] }).__fnClipboard]),
    currentLocation: async () => page.evaluate(() => `${location.pathname}${location.search}${location.hash}`),
    openAppLink: async (url: string) => page.evaluate(
      (link) => (window as unknown as { __fnFireNativeEvent: (p: string, e: string, d: unknown) => number })
        .__fnFireNativeEvent('App', 'appUrlOpen', { url: link }),
      url,
    ),
  };
}

/**
 * Native app (simulated Capacitor Android): copied share and folder links must
 * start with the public site URL, not the WebView origin.
 *
 * @param browser - Browser.
 * @param baseUrl - App URL.
 * @param session - Login response.
 * @param siteOrigin - Public site origin the build was made with.
 */
async function checkNativeShareLinks(browser: Browser, baseUrl: string, session: { token: string }, siteOrigin: string): Promise<void> {
  const native = await openNativePage(browser, baseUrl, session, null);
  const { page } = native;
  await page.goto(`${baseUrl}/perfuser`);
  await page.locator('.file-item').first().waitFor();

  const fileCard = page.locator('.file-item[data-id^="file:"]').first();
  await fileCard.hover();
  await fileCard.locator('button[title="分享"]').click();
  await page.waitForFunction(() => (window as unknown as { __fnClipboard: string[] }).__fnClipboard.length > 0, null, { timeout: 10_000 });
  const shareLink = (await native.clipboard()).at(-1);
  check(shareLink?.startsWith(`${siteOrigin}/share/`) === true,
    `share link must start with ${siteOrigin}/share/, got ${shareLink} (dialogs: ${native.dialogs.join(' | ')})`);

  const folderCard = page.locator('.folder-card', { hasText: '專案 1' }).first();
  await folderCard.hover();
  await folderCard.locator('button[title="分享"]').click();
  await page.waitForFunction(() => (window as unknown as { __fnClipboard: string[] }).__fnClipboard.length > 1, null, { timeout: 10_000 });
  const folderLink = (await native.clipboard()).at(-1);
  check(folderLink?.startsWith(`${siteOrigin}/perfuser?tab=file&folder=`) === true,
    `folder link must start with ${siteOrigin}/perfuser?tab=file&folder=, got ${folderLink}`);
  await page.context().close();
}

/**
 * Native app (simulated Capacitor Android): App Links must route the React
 * Router on cold start (`App.getLaunchUrl`) and while running (`appUrlOpen`),
 * ignore foreign hosts and not replay the launch URL on reload.
 *
 * @param browser - Browser.
 * @param baseUrl - App URL.
 * @param session - Login response.
 * @param siteOrigin - Public site origin the build was made with.
 */
async function checkNativeAppLinks(browser: Browser, baseUrl: string, session: { token: string }, siteOrigin: string): Promise<void> {
  const native = await openNativePage(browser, baseUrl, session, `${siteOrigin}/perfuser?tab=file#cold-start`);
  const { page } = native;
  await page.goto(`${baseUrl}/`);
  await page.waitForFunction(() => location.pathname === '/perfuser', null, { timeout: 10_000 }).catch(async (error: unknown) => {
    throw new Error(`CHECK FAILED: cold-start App Link not routed, at ${await native.currentLocation()} (${String(error)})`);
  });
  await page.locator('.file-item').first().waitFor();
  let routed = await native.currentLocation();
  check(routed === '/perfuser?tab=file#cold-start', `cold-start App Link must open /perfuser?tab=file#cold-start, at ${routed}`);

  check(await native.openAppLink(`${siteOrigin}/help?from=link`) > 0, 'no appUrlOpen listener registered');
  await page.waitForFunction(() => location.pathname === '/help', null, { timeout: 5_000 });
  routed = await native.currentLocation();
  check(routed === '/help?from=link', `appUrlOpen must route to /help?from=link, at ${routed}`);

  await native.openAppLink('https://evil.example/perfuser');
  await page.waitForTimeout(500);
  routed = await native.currentLocation();
  check(routed === '/help?from=link', `a foreign-host link must be ignored, at ${routed}`);

  // A reload (live update, server change) must not replay the launch link.
  await page.reload();
  // The desktop sidebar renders once the app booted (initNative finished).
  await page.getByText('iPhone 捷徑').first().waitFor();
  await page.waitForTimeout(1_000);
  routed = await native.currentLocation();
  check(routed === '/help?from=link', `reload must keep the current route, not replay the launch link; at ${routed}`);
  await page.context().close();
}

/** Run every check. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dist: { type: 'string' },
      'backend-port': { type: 'string', default: '5294' },
      'preview-port': { type: 'string', default: '4294' },
      // Run only the simulated-native link checks (faster iteration).
      'native-only': { type: 'boolean', default: false },
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
    for (const mobile of values['native-only'] ? [] : [true, false]) {
      for (const effects of ['full', 'low', 'plain']) {
        const label = `${mobile ? 'phone' : 'desktop'}/${effects}`;
        const page = await openPage(browser, mobile, effects, session);
        const requestedUrls: string[] = [];
        page.on('request', (request) => requestedUrls.push(request.url()));
        // First, while the UserPage chunk is still unloaded (fresh page).
        if (mobile) await checkDirectoryFirstNavigation(page, stack.baseUrl);
        if (mobile) await checkExclusiveDrawers(page, stack.baseUrl);
        await checkLanding(page, stack.baseUrl, workDir);
        await checkNoBrandFooter(page);
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
    const siteOrigin = await readBuildSiteOrigin(stack.baseUrl);
    check(siteOrigin !== new URL(stack.baseUrl).origin, 'VITE_SITE_URL must differ from the test origin to be meaningful');
    await checkNativeShareLinks(browser, stack.baseUrl, session, siteOrigin);
    process.stdout.write('ok native/share-links\n');
    await checkNativeAppLinks(browser, stack.baseUrl, session, siteOrigin);
    process.stdout.write('ok native/app-links\n');
  } finally {
    await browser.close();
    await stack.stop();
  }
}

await main();
