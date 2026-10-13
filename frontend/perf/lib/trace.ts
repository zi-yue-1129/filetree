/**
 * Chrome trace analysis: main-thread time per DevTools category (self time),
 * paint counts, and busy time of the raster workers and the GPU process.
 */

/** Trace categories recorded by the harness. */
export const TRACE_CATEGORIES: string[] = [
  'toplevel',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'v8.execute',
  'blink.user_timing',
  'loading',
  'cc',
  'gpu',
  'viz',
];

/** Raw trace event (subset of fields used here). */
interface TraceEvent {
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: { name?: string };
}

/** Aggregated trace numbers, all durations in milliseconds. */
export interface TraceSummary {
  scriptingMs: number;
  renderingMs: number;
  paintingMs: number;
  gcMs: number;
  mainBusyMs: number;
  rasterMs: number;
  gpuMs: number;
  paintCount: number;
  windowMs: number;
}

const SCRIPTING = new Set([
  'EvaluateScript', 'v8.compile', 'v8.compileModule', 'v8.evaluateModule', 'v8.run', 'FunctionCall',
  'TimerFire', 'EventDispatch', 'FireAnimationFrame', 'FireIdleCallback', 'RunMicrotasks',
  'XHRReadyStateChange', 'XHRLoad', 'V8.Execute', 'v8.callFunction', 'ParseHTML',
  'WebSocketReceiveHandshakeResponse', 'ResourceReceivedData',
]);
const RENDERING = new Set([
  'UpdateLayoutTree', 'Layout', 'RecalculateStyles', 'HitTest', 'PrePaint', 'UpdateLayerTree', 'Layerize', 'IntersectionObserverController::computeIntersections',
  'ComputeIntersections', 'ScrollLayer', 'ParseAuthorStyleSheet',
]);
const PAINTING = new Set([
  'Paint', 'PaintImage', 'CompositeLayers', 'Decode Image', 'ImageDecodeTask', 'Commit',
  // Canvas/picture layer updates (per-frame canvas uploads land here).
  'LayerTreeHost::DoUpdateLayers', 'UpdateLayer',
]);
const GC = new Set(['MajorGC', 'MinorGC', 'V8.GCScavenger', 'V8.GCFinalizeMC', 'BlinkGC.AtomicPhase']);

type Category = 'scripting' | 'rendering' | 'painting' | 'gc' | 'other';

/**
 * Map an event name to its DevTools-style category.
 *
 * @param name - Trace event name.
 * @returns Category, or null when the name is not classified.
 */
function categorize(name: string): Category | null {
  if (SCRIPTING.has(name)) return 'scripting';
  if (RENDERING.has(name)) return 'rendering';
  if (PAINTING.has(name)) return 'painting';
  if (GC.has(name)) return 'gc';
  return null;
}

/**
 * Sum the durations of top-level (non-nested) complete events.
 *
 * @param events - Complete events of one thread, any order.
 * @returns Busy time in microseconds.
 */
function topLevelBusy(events: TraceEvent[]): number {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  let busy = 0;
  let coveredUntil = -Infinity;
  for (const event of sorted) {
    const end = event.ts + (event.dur ?? 0);
    if (event.ts >= coveredUntil) {
      busy += end - event.ts;
      coveredUntil = end;
    } else if (end > coveredUntil) {
      busy += end - coveredUntil;
      coveredUntil = end;
    }
  }
  return busy;
}

/**
 * Compute self time per category for one thread.
 *
 * @param events - Complete events of the thread.
 * @returns Microseconds per category.
 */
function selfTimeByCategory(events: TraceEvent[]): Record<Category, number> {
  const totals: Record<Category, number> = { scripting: 0, rendering: 0, painting: 0, gc: 0, other: 0 };
  const sorted = [...events].sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
  interface Frame { end: number; category: Category; self: number }
  const stack: Frame[] = [];
  const flush = (frame: Frame): void => {
    totals[frame.category] += Math.max(0, frame.self);
  };
  for (const event of sorted) {
    const duration = event.dur ?? 0;
    while (stack.length > 0 && stack[stack.length - 1].end <= event.ts) {
      flush(stack.pop() as Frame);
    }
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    if (parent) parent.self -= duration;
    const category = categorize(event.name) ?? parent?.category ?? 'other';
    stack.push({ end: event.ts + duration, category, self: duration });
  }
  while (stack.length > 0) flush(stack.pop() as Frame);
  return totals;
}

/**
 * Summarize a Chrome trace produced with {@link TRACE_CATEGORIES}.
 *
 * @param traceJson - Raw trace buffer from `browser.stopTracing()`.
 * @returns Aggregated numbers in milliseconds.
 */
export function summarizeTrace(traceJson: Buffer): TraceSummary {
  const parsed = JSON.parse(traceJson.toString('utf-8')) as { traceEvents: TraceEvent[] } | TraceEvent[];
  const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
  const threadNames = new Map<string, string>();
  for (const event of events) {
    if (event.ph === 'M' && event.name === 'thread_name' && event.args?.name) {
      threadNames.set(`${event.pid}:${event.tid}`, event.args.name);
    }
  }
  const byThread = new Map<string, TraceEvent[]>();
  let minTs = Infinity;
  let maxTs = -Infinity;
  for (const event of events) {
    if (event.ph !== 'X' || event.dur === undefined) continue;
    const key = `${event.pid}:${event.tid}`;
    const list = byThread.get(key);
    if (list) list.push(event);
    else byThread.set(key, [event]);
    minTs = Math.min(minTs, event.ts);
    maxTs = Math.max(maxTs, event.ts + event.dur);
  }
  // The page's renderer main thread is the busiest CrRendererMain.
  let mainKey: string | null = null;
  let mainBusy = -1;
  for (const [key, list] of byThread) {
    if (threadNames.get(key) !== 'CrRendererMain') continue;
    const busy = topLevelBusy(list);
    if (busy > mainBusy) {
      mainBusy = busy;
      mainKey = key;
    }
  }
  if (mainKey === null) throw new Error('No CrRendererMain thread in trace');
  const mainEvents = byThread.get(mainKey) as TraceEvent[];
  const categories = selfTimeByCategory(mainEvents);
  const rendererPid = mainKey.split(':')[0];
  let rasterUs = 0;
  let gpuUs = 0;
  for (const [key, list] of byThread) {
    const name = threadNames.get(key) ?? '';
    if (key.startsWith(`${rendererPid}:`) && name.startsWith('CompositorTileWorker')) {
      rasterUs += topLevelBusy(list);
    }
    if (name === 'CrGpuMain' || name === 'VizCompositorThread') {
      gpuUs += topLevelBusy(list);
    }
  }
  const toMs = (microseconds: number): number => microseconds / 1000;
  return {
    scriptingMs: toMs(categories.scripting),
    renderingMs: toMs(categories.rendering),
    paintingMs: toMs(categories.painting),
    gcMs: toMs(categories.gc),
    mainBusyMs: toMs(mainBusy),
    rasterMs: toMs(rasterUs),
    gpuMs: toMs(gpuUs),
    paintCount: mainEvents.filter((event) => event.name === 'Paint').length,
    windowMs: Number.isFinite(minTs) ? toMs(maxTs - minTs) : 0,
  };
}
