/**
 * Perf scenarios: landing load + idle, dashboard load/idle/scroll, selecting
 * 50 files, and adding + uploading 20 files. Each returns flat numeric
 * metrics so runs can be aggregated by median.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Browser, Page } from 'playwright';
import {
  blockingTime,
  openInstrumentedPage,
  pageNow,
  readObservations,
  startFrameMeter,
  stopFrameMeter,
  usedHeapMiB,
  type DeviceOptions,
} from './lib/page.ts';
import { summarizeTrace, TRACE_CATEGORIES, type TraceSummary } from './lib/trace.ts';

/** Flat metric bag of one scenario run. */
export type Metrics = Record<string, number>;

/** Shared inputs of every scenario. */
export interface ScenarioContext {
  browser: Browser;
  baseUrl: string;
  device: DeviceOptions;
  auth: { token: string; user: unknown };
  username: string;
  password: string;
  workDir: string;
  /** Optional directory for a screenshot at the end of the scenario. */
  screenshotDir: string | null;
}

const IDLE_LANDING_MS = 5_000;
const IDLE_DASHBOARD_MS = 3_000;
const SELECT_TARGET = 50;
const UPLOAD_FILE_COUNT = 20;
const UPLOAD_FILE_BYTES = 256 * 1024;
const STEP_TIMEOUT_MS = 120_000;
/** Sequence number for raw traces saved when PERF_TRACE_DIR is set. */
let traceCounter = 0;

/**
 * Record JS bytes (raw and gzip) of every script response.
 *
 * @param page - Page to watch.
 * @returns Function resolving to the totals in KiB.
 */
function trackScripts(page: Page): () => Promise<{ rawKiB: number; gzipKiB: number }> {
  const pending: Array<Promise<{ raw: number; gzip: number }>> = [];
  page.on('response', (response) => {
    if (response.request().resourceType() !== 'script') return;
    pending.push(response.body().then((body) => ({ raw: body.length, gzip: gzipSync(body).length })));
  });
  return async () => {
    const sizes = await Promise.all(pending);
    return {
      rawKiB: sizes.reduce((sum, size) => sum + size.raw, 0) / 1024,
      gzipKiB: sizes.reduce((sum, size) => sum + size.gzip, 0) / 1024,
    };
  };
}

/**
 * Prefix and flatten a trace summary into metrics.
 *
 * @param prefix - Metric name prefix.
 * @param trace - Trace summary.
 * @param perSecond - Normalize busy times to ms per second of window.
 * @returns Metrics.
 */
function traceMetrics(prefix: string, trace: TraceSummary, perSecond: boolean): Metrics {
  const scale = perSecond ? 1000 / Math.max(trace.windowMs, 1) : 1;
  const suffix = perSecond ? 'MsPerS' : 'Ms';
  return {
    [`${prefix}Scripting${suffix}`]: trace.scriptingMs * scale,
    [`${prefix}Rendering${suffix}`]: trace.renderingMs * scale,
    [`${prefix}Painting${suffix}`]: trace.paintingMs * scale,
    [`${prefix}MainBusy${suffix}`]: trace.mainBusyMs * scale,
    [`${prefix}Raster${suffix}`]: trace.rasterMs * scale,
    [`${prefix}Gpu${suffix}`]: trace.gpuMs * scale,
    [`${prefix}PaintsPerS`]: (trace.paintCount * 1000) / Math.max(trace.windowMs, 1),
  };
}

/**
 * Trace an async action.
 *
 * @param context - Scenario context.
 * @param page - Page to trace.
 * @param action - Work to perform while tracing.
 * @returns The trace summary.
 */
async function traced(context: ScenarioContext, page: Page, action: () => Promise<void>): Promise<TraceSummary> {
  await context.browser.startTracing(page, { categories: TRACE_CATEGORIES });
  let buffer: Buffer;
  try {
    await action();
  } finally {
    // Always stop, otherwise the next startTracing() call fails.
    buffer = await context.browser.stopTracing();
  }
  const traceDir = process.env.PERF_TRACE_DIR;
  if (traceDir) {
    mkdirSync(traceDir, { recursive: true });
    traceCounter += 1;
    writeFileSync(path.join(traceDir, `trace-${String(traceCounter).padStart(3, '0')}.json`), buffer);
  }
  return summarizeTrace(buffer);
}

/**
 * Measure an idle window: frames plus a trace.
 *
 * @param context - Scenario context.
 * @param page - Page.
 * @param prefix - Metric prefix.
 * @param durationMs - Idle duration.
 * @returns Idle metrics.
 */
async function measureIdle(context: ScenarioContext, page: Page, prefix: string, durationMs: number): Promise<Metrics> {
  let frames = { fps: 0, droppedFrames: 0, frames: 0, seconds: 0 };
  const trace = await traced(context, page, async () => {
    await startFrameMeter(page);
    await page.waitForTimeout(durationMs);
    frames = await stopFrameMeter(page);
  });
  return { ...traceMetrics(prefix, trace, true), [`${prefix}Fps`]: frames.fps, [`${prefix}DroppedFrames`]: frames.droppedFrames };
}

/**
 * Save a screenshot when requested.
 *
 * @param context - Scenario context.
 * @param page - Page.
 * @param name - File stem.
 */
async function maybeScreenshot(context: ScenarioContext, page: Page, name: string): Promise<void> {
  if (!context.screenshotDir) return;
  mkdirSync(context.screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(context.screenshotDir, `${name}.png`) });
}

/** Scenario 1: landing page load, then 5 s idle. */
export async function landingScenario(context: ScenarioContext): Promise<Metrics> {
  const { context: browserContext, page, cdp } = await openInstrumentedPage(context.browser, context.device, null);
  try {
    const scripts = trackScripts(page);
    const loadTrace = await traced(context, page, async () => {
      await page.goto(`${context.baseUrl}/`, { waitUntil: 'load', timeout: STEP_TIMEOUT_MS });
      await page.getByText('資料傳輸核心').waitFor({ timeout: STEP_TIMEOUT_MS });
      await page.waitForTimeout(1_000);
    });
    const loadEnd = await pageNow(page);
    const idle = await measureIdle(context, page, 'idle', IDLE_LANDING_MS);
    const observations = await readObservations(page);
    const js = await scripts();
    const heap = await usedHeapMiB(cdp);
    await maybeScreenshot(context, page, 'landing');
    return {
      lcpMs: observations.lcpMs,
      tbtMs: blockingTime(observations.longTasks, 0, Number.POSITIVE_INFINITY),
      loadTbtMs: blockingTime(observations.longTasks, 0, loadEnd),
      jsRawKiB: js.rawKiB,
      jsGzipKiB: js.gzipKiB,
      heapMiB: heap,
      ...traceMetrics('load', loadTrace, false),
      ...idle,
    };
  } finally {
    await browserContext.close();
  }
}

/**
 * Open the dashboard and wait for the first file card.
 *
 * @param context - Scenario context.
 * @param page - Page.
 * @returns Page-clock time when the first file card was visible.
 */
async function openDashboard(context: ScenarioContext, page: Page): Promise<number> {
  await page.goto(`${context.baseUrl}/${context.username}`, { waitUntil: 'load', timeout: STEP_TIMEOUT_MS });
  await page.locator('.file-item').first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
  return pageNow(page);
}

/**
 * Ask the backend to broadcast REFRESH to the perf user's dashboards.
 *
 * @param context - Scenario context.
 */
async function triggerRefresh(context: ScenarioContext): Promise<void> {
  const body = new FormData();
  body.append('username', context.username);
  body.append('token', context.auth.token);
  body.append('show_in_list', 'true');
  const response = await fetch(`${context.baseUrl}/api/user/update-profile`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`update-profile failed: HTTP ${response.status}`);
}

/** Scenario 2: dashboard with 600 files: load, 3 s idle, scroll the list. */
export async function dashboardScenario(context: ScenarioContext): Promise<Metrics> {
  const { context: browserContext, page, cdp } = await openInstrumentedPage(context.browser, context.device, context.auth);
  try {
    const scripts = trackScripts(page);
    let readyMs = 0;
    const loadTrace = await traced(context, page, async () => {
      readyMs = await openDashboard(context, page);
    });
    await page.waitForTimeout(1_000);
    const idle = await measureIdle(context, page, 'idle', IDLE_DASHBOARD_MS);
    const scroller = page.locator('[data-testid="virtuoso-scroller"]');
    const box = await scroller.boundingBox();
    if (!box) throw new Error('virtuoso scroller not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300));
    const scrollStart = await pageNow(page);
    let frames = { fps: 0, droppedFrames: 0, frames: 0, seconds: 0 };
    const scrollTrace = await traced(context, page, async () => {
      await startFrameMeter(page);
      for (let step = 0; step < 24; step += 1) {
        await page.mouse.wheel(0, 260);
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(500);
      frames = await stopFrameMeter(page);
    });
    const scrollEnd = await pageNow(page);
    const scrolledPx = await scroller.evaluate((element) => element.scrollTop);
    if (scrolledPx < 1_000) throw new Error(`scroll did not move the list (scrollTop=${scrolledPx})`);
    // WebSocket REFRESH: a no-op profile update makes the backend broadcast
    // REFRESH (dashboard refetch) and USER_LIST_UPDATE (global /init refetch).
    const refreshStart = await pageNow(page);
    const refreshTrace = await traced(context, page, async () => {
      const refetch = page.waitForResponse(
        (response) => response.request().method() === 'GET' && response.url().endsWith(`/api/user/${context.username}`),
        { timeout: STEP_TIMEOUT_MS },
      );
      await triggerRefresh(context);
      await refetch;
      await page.waitForTimeout(1_500);
    });
    const refreshEnd = await pageNow(page);
    const observations = await readObservations(page);
    const js = await scripts();
    const heap = await usedHeapMiB(cdp);
    await maybeScreenshot(context, page, 'dashboard');
    return {
      readyMs,
      lcpMs: observations.lcpMs,
      loadTbtMs: blockingTime(observations.longTasks, 0, readyMs + 1_000),
      jsRawKiB: js.rawKiB,
      jsGzipKiB: js.gzipKiB,
      heapMiB: heap,
      ...traceMetrics('load', loadTrace, false),
      ...idle,
      ...traceMetrics('scroll', scrollTrace, true),
      scrollFps: frames.fps,
      scrollDroppedFrames: frames.droppedFrames,
      scrollTbtMs: blockingTime(observations.longTasks, scrollStart, scrollEnd),
      refreshScriptingMs: refreshTrace.scriptingMs,
      refreshMainBusyMs: refreshTrace.mainBusyMs,
      refreshTbtMs: blockingTime(observations.longTasks, refreshStart, refreshEnd),
    };
  } finally {
    await browserContext.close();
  }
}

/** Scenario 3: enter selection mode and select 50 files one by one. */
export async function selectScenario(context: ScenarioContext): Promise<Metrics> {
  const { context: browserContext, page, cdp } = await openInstrumentedPage(context.browser, context.device, context.auth);
  try {
    await openDashboard(context, page);
    await page.locator('header button:has(svg.lucide-settings)').click();
    await page.getByRole('button', { name: '選擇檔案' }).click();
    await page.getByText('全選').waitFor({ timeout: STEP_TIMEOUT_MS });
    await page.waitForTimeout(1_000);
    const clicked = new Set<string>();
    const start = await pageNow(page);
    const wallStart = Date.now();
    const trace = await traced(context, page, async () => {
      while (clicked.size < SELECT_TARGET) {
        const candidates = await page.evaluate((done) => {
          const scrollerElement = document.querySelector('[data-testid="virtuoso-scroller"]');
          if (!scrollerElement) throw new Error('scroller missing');
          const bounds = scrollerElement.getBoundingClientRect();
          return Array.from(document.querySelectorAll<HTMLElement>('.file-item[data-id^="file:"]'))
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return rect.top >= bounds.top && rect.bottom <= bounds.bottom && !done.includes(element.dataset.id ?? '');
            })
            .map((element) => element.dataset.id ?? '');
        }, [...clicked]);
        if (candidates.length === 0) {
          await page.locator('[data-testid="virtuoso-scroller"]').evaluate((element) => {
            element.scrollTop += 300;
          });
          await page.waitForTimeout(150);
          continue;
        }
        const dataId = candidates[0];
        await page.locator(`[data-id="${dataId}"] button`).first().click();
        clicked.add(dataId);
      }
      await page.waitForTimeout(500);
    });
    const wallMs = Date.now() - wallStart;
    const end = await pageNow(page);
    const observations = await readObservations(page);
    const clickDurations = observations.clickLatencies
      .filter((entry) => entry.start >= start && entry.start <= end)
      .map((entry) => entry.duration)
      .sort((a, b) => a - b);
    if (clickDurations.length < SELECT_TARGET) {
      throw new Error(`only ${clickDurations.length} click latencies recorded for ${SELECT_TARGET} clicks`);
    }
    const heap = await usedHeapMiB(cdp);
    await maybeScreenshot(context, page, 'select');
    return {
      selectWallMs: wallMs,
      clickP75Ms: clickDurations[Math.floor(clickDurations.length * 0.75)],
      clickMaxMs: clickDurations[clickDurations.length - 1],
      selectTbtMs: blockingTime(observations.longTasks, start, end),
      selectMainBusyPerClickMs: trace.mainBusyMs / SELECT_TARGET,
      heapMiB: heap,
      ...traceMetrics('select', trace, false),
    };
  } finally {
    await browserContext.close();
  }
}

/**
 * Create the deterministic upload payloads once.
 *
 * @param workDir - Directory for the files.
 * @returns Absolute file paths.
 */
function uploadFiles(workDir: string): string[] {
  const directory = path.join(workDir, 'upload-files');
  mkdirSync(directory, { recursive: true });
  const files: string[] = [];
  for (let index = 0; index < UPLOAD_FILE_COUNT; index += 1) {
    const filePath = path.join(directory, `upload_${String(index).padStart(2, '0')}.bin`);
    const content = Buffer.alloc(UPLOAD_FILE_BYTES, index + 1);
    writeFileSync(filePath, content);
    files.push(filePath);
  }
  return files;
}

/** Scenario 4: add 20 files to the uploader, then upload them. */
export async function uploadScenario(context: ScenarioContext): Promise<Metrics> {
  const { context: browserContext, page, cdp } = await openInstrumentedPage(context.browser, context.device, null);
  try {
    let consoleMessages = 0;
    page.on('console', () => {
      consoleMessages += 1;
    });
    await page.goto(`${context.baseUrl}/`, { waitUntil: 'load', timeout: STEP_TIMEOUT_MS });
    await page.getByText('資料傳輸核心').waitFor({ timeout: STEP_TIMEOUT_MS });
    await page.waitForTimeout(1_000);
    const files = uploadFiles(context.workDir);
    const addStart = await pageNow(page);
    const addWallStart = Date.now();
    const addTrace = await traced(context, page, async () => {
      await page.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(files);
      await page.getByText(`待傳檔案 (${UPLOAD_FILE_COUNT})`).waitFor({ timeout: STEP_TIMEOUT_MS });
    });
    const addWallMs = Date.now() - addWallStart;
    const addEnd = await pageNow(page);
    await page.waitForTimeout(1_000);
    await maybeScreenshot(context, page, 'upload-added');
    const before = await cdp.send('Performance.getMetrics');
    const consoleBefore = consoleMessages;
    const uploadStart = await pageNow(page);
    const uploadWallStart = Date.now();
    await page.getByPlaceholder('輸入解鎖密碼').fill(context.password);
    await page.getByRole('button', { name: '提交資料' }).click();
    await page.waitForURL(`**/${context.username}`, { timeout: STEP_TIMEOUT_MS });
    const uploadWallMs = Date.now() - uploadWallStart;
    // Client-side navigation: same document, so the page clock continues.
    const uploadEnd = await pageNow(page);
    const after = await cdp.send('Performance.getMetrics');
    const metric = (bag: typeof before, name: string): number => {
      const found = bag.metrics.find((entry) => entry.name === name);
      if (!found) throw new Error(`${name} missing`);
      return found.value;
    };
    const observations = await readObservations(page);
    return {
      addWallMs,
      addTbtMs: blockingTime(observations.longTasks, addStart, addEnd + 1),
      ...traceMetrics('add', addTrace, false),
      uploadWallMs,
      uploadScriptMs: (metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration')) * 1000,
      uploadTaskMs: (metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000,
      uploadTbtMs: blockingTime(observations.longTasks, uploadStart, uploadEnd + 1),
      uploadConsoleMessages: consoleMessages - consoleBefore,
    };
  } finally {
    await browserContext.close();
  }
}
