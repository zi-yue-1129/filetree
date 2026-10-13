/**
 * Low-end phone emulation and in-page instrumentation (long tasks, LCP,
 * event timing, rAF frame meter) for the perf harness.
 */
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright';

/** Effects preference written to localStorage before the app boots. */
export type EffectsSetting = 'auto' | 'full' | 'low';

/** Options describing the emulated device. */
export interface DeviceOptions {
  /** CPU slowdown factor applied through CDP. */
  cpuThrottle: number;
  /** `navigator.hardwareConcurrency` reported to the page. */
  hardwareConcurrency: number;
  /** `navigator.deviceMemory` reported to the page (GiB). */
  deviceMemory: number;
  /** Apply "Slow 4G"-like network throttling. */
  slowNetwork: boolean;
  /** Theme stored in localStorage (`filenexus-theme`). */
  theme: 'dark' | 'light';
  /** Effects preference (`filenexus-effects`); `auto` leaves it unset. */
  effects: EffectsSetting;
  /** Viewport width/height in CSS px. */
  viewport: { width: number; height: number };
  /** Whether to emulate a touch phone. */
  mobile: boolean;
}

/** A page prepared with emulation and instrumentation. */
export interface InstrumentedPage {
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
}

/** Values collected by the in-page observers. */
export interface PageObservations {
  lcpMs: number;
  longTasks: Array<{ start: number; duration: number }>;
  interactions: Array<{ name: string; start: number; duration: number }>;
  /** Click-to-next-frame latencies (event timestamp to after the next rAF). */
  clickLatencies: Array<{ start: number; duration: number }>;
}

/** rAF frame statistics. */
export interface FrameStats {
  fps: number;
  droppedFrames: number;
  frames: number;
  seconds: number;
}

interface PerfWindow extends Window {
  __perf?: PageObservations & { frameTimes: number[] | null; frameHandle: number };
}

/** Init script: registers performance observers (runs before app code). */
function installObservers(): void {
  const perfWindow = window as PerfWindow;
  const store: PageObservations & { frameTimes: number[] | null; frameHandle: number } = {
    lcpMs: 0,
    longTasks: [],
    interactions: [],
    clickLatencies: [],
    frameTimes: null,
    frameHandle: 0,
  };
  perfWindow.__perf = store;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) store.longTasks.push({ start: entry.startTime, duration: entry.duration });
  }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    store.lcpMs = entries[entries.length - 1].startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      store.interactions.push({ name: entry.name, start: entry.startTime, duration: entry.duration });
    }
  }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
  // INP-like: from the pointerup timestamp until the frame after it was handled.
  // (pointerup, not click: the dashboard toggles selection on mouseup and the
  // re-render swallows the click event.)
  window.addEventListener(
    'pointerup',
    (event) => {
      const start = event.timeStamp;
      requestAnimationFrame(() => {
        setTimeout(() => store.clickLatencies.push({ start, duration: performance.now() - start }), 0);
      });
    },
    { capture: true },
  );
}

/**
 * Create a context + page that emulates a low-end phone.
 *
 * @param browser - Running Chromium.
 * @param device - Device emulation options.
 * @param auth - Optional session to store in localStorage before boot.
 * @returns Prepared page with its CDP session.
 */
export async function openInstrumentedPage(
  browser: Browser,
  device: DeviceOptions,
  auth: { token: string; user: unknown } | null,
): Promise<InstrumentedPage> {
  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.mobile ? 2 : 1,
    isMobile: device.mobile,
    hasTouch: device.mobile,
    colorScheme: device.theme,
    locale: 'zh-TW',
  });
  await context.addInitScript(
    ({ theme, effects, deviceMemory, session }) => {
      localStorage.setItem('filenexus-theme', theme);
      if (effects === 'auto') localStorage.removeItem('filenexus-effects');
      else localStorage.setItem('filenexus-effects', effects);
      Object.defineProperty(Navigator.prototype, 'deviceMemory', { configurable: true, get: () => deviceMemory });
      if (session) {
        localStorage.setItem('filenexus_token', session.token);
        localStorage.setItem('filenexus_user', JSON.stringify(session.user));
      }
    },
    { theme: device.theme, effects: device.effects, deviceMemory: device.deviceMemory, session: auth },
  );
  await context.addInitScript(installObservers);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: device.cpuThrottle });
  await cdp.send('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: device.hardwareConcurrency });
  if (device.slowNetwork) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
  }
  return { context, page, cdp };
}

/**
 * Read the in-page observations.
 *
 * @param page - Instrumented page.
 * @returns Snapshot of LCP, long tasks and slow interactions.
 */
export async function readObservations(page: Page): Promise<PageObservations> {
  return page.evaluate(() => {
    const store = (window as PerfWindow).__perf;
    if (!store) throw new Error('perf observers missing');
    return {
      lcpMs: store.lcpMs,
      longTasks: [...store.longTasks],
      interactions: [...store.interactions],
      clickLatencies: [...store.clickLatencies],
    };
  });
}

/**
 * Current `performance.now()` of the page.
 *
 * @param page - Page.
 * @returns Milliseconds since navigation start.
 */
export async function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

/**
 * Total blocking time of long tasks that started inside a window.
 *
 * @param longTasks - Long task entries.
 * @param fromMs - Window start (page clock).
 * @param toMs - Window end (page clock).
 * @returns Sum of (duration - 50 ms) over the long tasks.
 */
export function blockingTime(longTasks: Array<{ start: number; duration: number }>, fromMs: number, toMs: number): number {
  return longTasks
    .filter((task) => task.start >= fromMs && task.start < toMs)
    .reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0);
}

/**
 * Start recording rAF timestamps in the page.
 *
 * @param page - Page.
 */
export async function startFrameMeter(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as PerfWindow).__perf;
    if (!store) throw new Error('perf observers missing');
    const times: number[] = [];
    store.frameTimes = times;
    const tick = (timestamp: number): void => {
      times.push(timestamp);
      store.frameHandle = requestAnimationFrame(tick);
    };
    store.frameHandle = requestAnimationFrame(tick);
  });
}

/**
 * Stop the rAF meter and compute FPS / dropped frames (60 Hz budget).
 *
 * @param page - Page.
 * @returns Frame statistics for the metered window.
 */
export async function stopFrameMeter(page: Page): Promise<FrameStats> {
  const times = await page.evaluate(() => {
    const store = (window as PerfWindow).__perf;
    if (!store || !store.frameTimes) throw new Error('frame meter not running');
    cancelAnimationFrame(store.frameHandle);
    const recorded = store.frameTimes;
    store.frameTimes = null;
    return recorded;
  });
  if (times.length < 2) return { fps: 0, droppedFrames: 0, frames: times.length, seconds: 0 };
  const budgetMs = 1000 / 60;
  let dropped = 0;
  for (let index = 1; index < times.length; index += 1) {
    dropped += Math.max(0, Math.round((times[index] - times[index - 1]) / budgetMs) - 1);
  }
  const seconds = (times[times.length - 1] - times[0]) / 1000;
  return { fps: (times.length - 1) / seconds, droppedFrames: dropped, frames: times.length, seconds };
}

/**
 * Force a GC and read the used JS heap.
 *
 * @param cdp - CDP session of the page.
 * @returns Used JS heap in MiB.
 */
export async function usedHeapMiB(cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const used = metrics.find((metric) => metric.name === 'JSHeapUsedSize');
  if (!used) throw new Error('JSHeapUsedSize missing from Performance.getMetrics');
  return used.value / (1024 * 1024);
}
