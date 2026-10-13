/**
 * Result files and markdown tables for the perf harness.
 */
import { readFileSync } from 'node:fs';

/** Metric runs keyed by theme, then by scenario. */
export type RunTable = Record<string, Record<string, Array<Record<string, number>>>>;

/** Persisted result of one harness invocation. */
export interface ResultFile {
  label: string;
  createdAt: string;
  options: Record<string, unknown>;
  runs: RunTable;
}

/**
 * Metrics shown in tables. Raster-worker time and paint counts stay in the
 * JSON only: headless Chromium composites in software here, so both read 0.
 */
export const METRIC_LABELS: Record<string, string> = {
  lcpMs: 'LCP (ms)',
  tbtMs: 'TBT, load+idle (ms)',
  loadTbtMs: 'TBT, load (ms)',
  readyMs: 'First file card visible (ms)',
  jsRawKiB: 'JS transferred, raw (KiB)',
  jsGzipKiB: 'JS transferred, gzip (KiB)',
  heapMiB: 'JS heap after GC (MiB)',
  loadScriptingMs: 'Load: scripting (ms)',
  loadRenderingMs: 'Load: rendering (ms)',
  loadPaintingMs: 'Load: painting (ms)',
  loadGpuMs: 'Load: GPU process busy (ms)',
  idleFps: 'Idle: FPS',
  idleDroppedFrames: 'Idle: dropped frames',
  idleMainBusyMsPerS: 'Idle: main thread busy (ms/s)',
  idleScriptingMsPerS: 'Idle: scripting (ms/s)',
  idlePaintingMsPerS: 'Idle: painting (ms/s)',
  idleGpuMsPerS: 'Idle: GPU process busy (ms/s)',
  scrollFps: 'Scroll: FPS',
  scrollDroppedFrames: 'Scroll: dropped frames',
  scrollTbtMs: 'Scroll: TBT (ms)',
  scrollMainBusyMsPerS: 'Scroll: main thread busy (ms/s)',
  scrollScriptingMsPerS: 'Scroll: scripting (ms/s)',
  scrollRenderingMsPerS: 'Scroll: rendering (ms/s)',
  scrollPaintingMsPerS: 'Scroll: painting (ms/s)',
  scrollGpuMsPerS: 'Scroll: GPU process busy (ms/s)',
  refreshScriptingMs: 'WS REFRESH: scripting (ms)',
  refreshMainBusyMs: 'WS REFRESH: main thread busy (ms)',
  refreshTbtMs: 'WS REFRESH: TBT (ms)',
  selectWallMs: 'Select 50: wall time (ms)',
  clickP75Ms: 'Select 50: tap-to-next-frame p75 (ms)',
  clickMaxMs: 'Select 50: tap-to-next-frame max (ms)',
  selectTbtMs: 'Select 50: TBT (ms)',
  selectMainBusyPerClickMs: 'Select 50: main thread busy per click (ms)',
  selectScriptingMs: 'Select 50: scripting (ms)',
  selectRenderingMs: 'Select 50: rendering (ms)',
  addWallMs: 'Add 20 files: wall time (ms)',
  addTbtMs: 'Add 20 files: TBT (ms)',
  addScriptingMs: 'Add 20 files: scripting (ms)',
  uploadWallMs: 'Upload 20 files: wall time (ms)',
  uploadScriptMs: 'Upload 20 files: script time (ms)',
  uploadTbtMs: 'Upload 20 files: TBT (ms)',
  uploadConsoleMessages: 'Upload 20 files: console messages',
};

/**
 * Median of a list of numbers.
 *
 * @param values - Samples.
 * @returns Median, or NaN for an empty list.
 */
export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Format a number for a table cell.
 *
 * @param value - Value.
 * @returns Human-readable string.
 */
function formatValue(value: number): string {
  if (Number.isNaN(value)) return '–';
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

/**
 * Load a result file.
 *
 * @param filePath - JSON path.
 * @returns Parsed result.
 */
export function loadResult(filePath: string): ResultFile {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as ResultFile;
}

/**
 * Render a markdown table comparing medians of several result files.
 *
 * @param results - Results (one column each).
 * @returns Markdown text, one table per theme/scenario pair.
 */
export function renderComparison(results: ResultFile[]): string {
  const lines: string[] = [];
  const themes = [...new Set(results.flatMap((result) => Object.keys(result.runs)))];
  for (const theme of themes) {
    const scenarios = [...new Set(results.flatMap((result) => Object.keys(result.runs[theme] ?? {})))];
    for (const scenario of scenarios) {
      const runCounts = results.map((result) => result.runs[theme]?.[scenario]?.length ?? 0);
      lines.push(`#### ${scenario} (${theme} theme; medians of ${runCounts.join(' / ')} runs)`, '');
      lines.push(`| Metric | ${results.map((result) => result.label).join(' | ')} |`);
      lines.push(`| --- | ${results.map(() => '---:').join(' | ')} |`);
      const metricNames = Object.keys(METRIC_LABELS).filter((name) =>
        results.some((result) => result.runs[theme]?.[scenario]?.some((run) => name in run)),
      );
      for (const name of metricNames) {
        const cells = results.map((result) =>
          formatValue(median((result.runs[theme]?.[scenario] ?? []).map((run) => run[name]).filter((value) => value !== undefined))),
        );
        lines.push(`| ${METRIC_LABELS[name]} | ${cells.join(' | ')} |`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}
