/**
 * Simulated native (Capacitor Android) landing-page upload: pick a file with
 * the fake system picker, submit, then drive the native queue's
 * `uploadProgress` events. Shared by the functional check (assertions) and
 * the tap target audit (screens while an upload is in flight).
 */
import type { Browser, Page } from 'playwright';
import { fakeAndroidBridge } from './fakeAndroid.ts';

/** Job id the fake `enqueueUpload` hands out. */
export const NATIVE_JOB_ID = 'job-landing-1';

/** File name of the picked file. */
export const NATIVE_FILE_NAME = 'IMG_20261022_101500.jpg';

/** Size of the picked file in bytes (3 MiB). */
export const NATIVE_FILE_SIZE = 3 * 1024 * 1024;

/** Options for {@link openNativeUploadPage}. */
export interface NativeUploadPageOptions {
  /** Viewport size. */
  viewport: { width: number; height: number };
  /** Stored theme. */
  theme: 'dark' | 'light';
  /** Stored effects preference. */
  effects: string;
  /** Login response stored as the app session. */
  session: { token: string };
}

/** Upload states sent by the native queue. */
export type NativeUploadState = 'queued' | 'uploading' | 'retrying' | 'completed' | 'failed' | 'cancelled';

/**
 * Canned plugin responses for a signed-in device with one picked file whose
 * queue job is known to `getUploads`.
 *
 * @returns Responses keyed `Plugin.method`.
 */
export function nativeUploadResponses(): Record<string, unknown> {
  const now = Date.now();
  return {
    'FileNexusNative.getConfiguration': {
      serverUrl: 'http://127.0.0.1',
      deviceToken: 'fake-device-token',
      deviceId: 'fake-device',
      deviceName: 'Pixel',
    },
    'FileNexusNative.pickFiles': {
      files: [{ uri: 'content://media/1', name: NATIVE_FILE_NAME, mimeType: 'image/jpeg', size: NATIVE_FILE_SIZE }],
    },
    'FileNexusNative.enqueueUpload': { jobIds: [NATIVE_JOB_ID] },
    'FileNexusNative.getUploads': {
      uploads: [{
        jobId: NATIVE_JOB_ID,
        name: NATIVE_FILE_NAME,
        mimeType: 'image/jpeg',
        folderId: null,
        source: 'app',
        state: 'queued',
        bytesSent: 0,
        bytesTotal: NATIVE_FILE_SIZE,
        error: null,
        createdAt: now,
        updatedAt: now,
      }],
    },
  };
}

/**
 * Open a page running as the signed-in (simulated) Android app.
 *
 * @param browser - Browser.
 * @param options - Page options.
 * @returns The page; every dialog is accepted.
 */
export async function openNativeUploadPage(browser: Browser, options: NativeUploadPageOptions): Promise<Page> {
  const context = await browser.newContext({
    viewport: options.viewport,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    colorScheme: options.theme,
    locale: 'zh-TW',
  });
  // Nothing may leave the machine (the app checks GitHub for updates).
  await context.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
  await context.addInitScript(
    ({ theme, effects, user }) => {
      localStorage.setItem('filenexus-theme', theme);
      localStorage.setItem('filenexus-effects', effects);
      localStorage.setItem('filenexus_token', user.token);
      localStorage.setItem('filenexus_user', JSON.stringify(user));
    },
    { theme: options.theme, effects: options.effects, user: options.session },
  );
  await context.addInitScript(fakeAndroidBridge, { launchUrl: null, responses: nativeUploadResponses() });
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  return page;
}

/**
 * Pick the file on the landing page and submit it with the password.
 *
 * @param page - Native page.
 * @param baseUrl - App URL.
 * @param password - Account password.
 */
export async function submitNativeUpload(page: Page, baseUrl: string, password: string): Promise<void> {
  await page.goto(`${baseUrl}/`);
  await page.getByRole('button', { name: '選擇檔案' }).click();
  await page.getByText(NATIVE_FILE_NAME).first().waitFor();
  await page.getByPlaceholder('輸入解鎖密碼').fill(password);
  await page.getByRole('button', { name: /提交資料/ }).click();
}

/**
 * Emit one native `uploadProgress` event for the landing job.
 *
 * @param page - Native page.
 * @param state - Job state.
 * @param bytesSent - Bytes acknowledged so far.
 * @param error - Error message for failed/retrying jobs.
 * @returns Number of listeners that received the event.
 */
export async function emitNativeProgress(
  page: Page,
  state: NativeUploadState,
  bytesSent: number,
  error: string | null = null,
): Promise<number> {
  return page.evaluate(
    (event) => (window as unknown as { __fnFireNativeEvent: (p: string, e: string, d: unknown) => number })
      .__fnFireNativeEvent('FileNexusNative', 'uploadProgress', event),
    { jobId: NATIVE_JOB_ID, bytesSent, bytesTotal: NATIVE_FILE_SIZE, state, error },
  );
}

/**
 * Count live `uploadProgress` listeners (to verify unsubscribe on unmount).
 *
 * @param page - Native page.
 * @returns Listener count.
 */
export async function nativeProgressListenerCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __fnNativeListenerCount: (p: string, e: string) => number })
    .__fnNativeListenerCount('FileNexusNative', 'uploadProgress'));
}

/**
 * Fail with a descriptive error.
 *
 * @param condition - Must be true.
 * @param message - Error message.
 */
function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`);
}

/**
 * Navigate inside the SPA (no reload), so components really unmount.
 *
 * @param page - Page.
 * @param pathname - Target path.
 */
async function navigateInApp(page: Page, pathname: string): Promise<void> {
  await page.evaluate((target) => {
    history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, pathname);
}

/**
 * Native app: after submitting, the landing upload card must show the native
 * queue's progress inline (state, percent, bytes, cancel), update on every
 * `uploadProgress` event, open the dashboard once the upload completed (as the
 * web does after Uppy finishes) and stop listening when it unmounts.
 *
 * @param browser - Browser.
 * @param baseUrl - App URL.
 * @param session - Login response.
 * @param password - Account password.
 * @param screenshotPath - Where to save a phone screenshot mid-upload, or null.
 */
export async function checkNativeUploadProgress(
  browser: Browser,
  baseUrl: string,
  session: { token: string },
  password: string,
  screenshotPath: string | null,
): Promise<void> {
  const page = await openNativeUploadPage(browser, {
    viewport: { width: 412, height: 915 },
    theme: 'dark',
    effects: 'full',
    session,
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await submitNativeUpload(page, baseUrl, password);

  const progress = page.getByRole('region', { name: '上傳進度' });
  await progress.waitFor({ timeout: 10_000 }).catch((error: unknown) => {
    throw new Error(`CHECK FAILED: no inline upload progress after submit, at ${page.url()} (${String(error)})`);
  });
  await progress.getByText('排隊中').first().waitFor({ timeout: 5_000 });
  expect(new URL(page.url()).pathname === '/', `the landing page must stay open while uploading, at ${page.url()}`);
  expect(await nativeProgressListenerCount(page) > 0, 'the landing page must subscribe to uploadProgress');

  await emitNativeProgress(page, 'uploading', NATIVE_FILE_SIZE / 2);
  const bar = progress.getByRole('progressbar', { name: `${NATIVE_FILE_NAME} 上傳進度` });
  await page.waitForFunction(
    () => document.querySelector('[role="progressbar"][aria-valuenow="50"]') !== null,
    null,
    { timeout: 5_000 },
  );
  expect(await bar.getAttribute('aria-valuenow') === '50', 'progress bar must report 50%');
  await progress.getByText('上傳中').first().waitFor({ timeout: 5_000 });
  await progress.getByText('50%').first().waitFor({ timeout: 5_000 });
  await progress.getByText('1.5 MB / 3.0 MB').first().waitFor({ timeout: 5_000 });
  if (screenshotPath) {
    await progress.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: screenshotPath });
  }

  const cancel = progress.getByRole('button', { name: `取消上傳 ${NATIVE_FILE_NAME}` });
  await cancel.click();
  const cancelCalls = await page.evaluate(() => (window as unknown as { __fnNativeCalls: Array<{ key: string; options: unknown }> })
    .__fnNativeCalls.filter((call) => call.key === 'FileNexusNative.cancelUpload'));
  expect(JSON.stringify(cancelCalls.at(-1)?.options) === JSON.stringify({ jobId: NATIVE_JOB_ID }),
    `cancel must call cancelUpload for the job, calls ${JSON.stringify(cancelCalls)}`);

  await emitNativeProgress(page, 'retrying', NATIVE_FILE_SIZE / 2, 'timeout');
  await progress.getByText('重試中').first().waitFor({ timeout: 5_000 });
  await progress.getByText('timeout').first().waitFor({ timeout: 5_000 });

  await emitNativeProgress(page, 'completed', NATIVE_FILE_SIZE);
  await page.waitForFunction(() => location.pathname !== '/', null, { timeout: 10_000 }).catch((error: unknown) => {
    throw new Error(`CHECK FAILED: completed upload must open the dashboard, at ${page.url()} (${String(error)})`);
  });
  expect(new URL(page.url()).pathname === '/perfuser', `must open /perfuser after completion, at ${page.url()}`);

  await navigateInApp(page, '/help');
  await page.waitForFunction(() => location.pathname === '/help', null, { timeout: 5_000 });
  await page.getByRole('heading').first().waitFor();
  await page.waitForTimeout(300);
  expect(await nativeProgressListenerCount(page) === 0, 'uploadProgress listeners must be removed on unmount');
  expect(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  await page.context().close();
}
