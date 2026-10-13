/**
 * Visual-effects level ("low-power mode") detection and persistence.
 *
 * The UI has two effect levels:
 * - `full`: animated canvas background, backdrop blur, idle animations.
 * - `low`: static background, no backdrop-filter, no infinite animations and
 *   framer-motion limited to opacity (for cheap phones, old tablets and users
 *   who asked the OS to reduce motion).
 *
 * The user preference (`auto` | `full` | `low`) is stored in localStorage.
 * `auto` resolves to `low` on low-end heuristics or slow startup frames.
 */

/** User-facing preference. */
export type EffectsPreference = 'auto' | 'full' | 'low';

/** Effective effect level applied to the document. */
export type EffectsLevel = 'full' | 'low';

/** Why `auto` resolved to `low` (or null when it did not). */
export type LowPowerReason = 'reduced-motion' | 'few-cores' | 'low-memory' | 'slow-frames' | null;

/** localStorage key of the preference. */
export const EFFECTS_STORAGE_KEY = 'filenexus-effects';

/** Thresholds of the static low-end heuristics. */
const MAX_LOW_END_CORES = 4;
const MAX_LOW_END_MEMORY_GIB = 4;

/** Startup frame probe: sampled frames and the "slow" limits. */
const PROBE_FRAME_COUNT = 40;
const PROBE_TIMEOUT_MS = 3_000;
const SLOW_MEDIAN_FRAME_MS = 25;
const JANK_FRAME_MS = 34;
const MAX_JANK_FRAME_RATIO = 0.3;

/** `navigator.deviceMemory` is Chromium-only and missing from lib.dom. */
interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

/**
 * Read the stored preference.
 *
 * @returns Stored preference, `auto` when unset or invalid.
 */
export function readEffectsPreference(): EffectsPreference {
  const stored = localStorage.getItem(EFFECTS_STORAGE_KEY);
  if (stored === null) return 'auto';
  if (stored === 'auto' || stored === 'full' || stored === 'low') return stored;
  // A corrupted cosmetic preference must not keep the whole app from booting:
  // report it, drop the bad value and fall back to automatic detection.
  console.error(`Invalid ${EFFECTS_STORAGE_KEY} value in localStorage, resetting to auto:`, stored);
  localStorage.removeItem(EFFECTS_STORAGE_KEY);
  return 'auto';
}

/**
 * Persist the preference (`auto` removes the key).
 *
 * @param preference - New preference.
 */
export function writeEffectsPreference(preference: EffectsPreference): void {
  if (preference === 'auto') localStorage.removeItem(EFFECTS_STORAGE_KEY);
  else localStorage.setItem(EFFECTS_STORAGE_KEY, preference);
}

/**
 * Static low-end heuristics (no measurement).
 *
 * @returns The first matching reason, or null for a capable device.
 */
export function detectLowEndDevice(): LowPowerReason {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'reduced-motion';
  const cores = navigator.hardwareConcurrency;
  if (cores > 0 && cores <= MAX_LOW_END_CORES) return 'few-cores';
  const memory = (navigator as NavigatorWithMemory).deviceMemory;
  if (memory !== undefined && memory <= MAX_LOW_END_MEMORY_GIB) return 'low-memory';
  return null;
}

/**
 * Sample animation frames and decide whether the device renders slowly.
 *
 * Resolves `false` when the page is hidden (no frames to measure) or the
 * probe times out before collecting enough frames while visible.
 *
 * @returns Whether the measured frames are slow.
 */
export function probeSlowFrames(): Promise<boolean> {
  return new Promise((resolve) => {
    if (document.visibilityState !== 'visible') {
      resolve(false);
      return;
    }
    const intervals: number[] = [];
    let previous: number | null = null;
    let handle = 0;
    const timeout = window.setTimeout(() => {
      cancelAnimationFrame(handle);
      // Very few frames inside the timeout is itself a sign of a slow device.
      resolve(document.visibilityState === 'visible' && intervals.length < PROBE_FRAME_COUNT / 2);
    }, PROBE_TIMEOUT_MS);
    const tick = (timestamp: number): void => {
      if (previous !== null) intervals.push(timestamp - previous);
      previous = timestamp;
      if (intervals.length < PROBE_FRAME_COUNT) {
        handle = requestAnimationFrame(tick);
        return;
      }
      window.clearTimeout(timeout);
      const sorted = [...intervals].sort((a, b) => a - b);
      const medianFrame = sorted[Math.floor(sorted.length / 2)];
      const jankRatio = intervals.filter((interval) => interval > JANK_FRAME_MS).length / intervals.length;
      resolve(medianFrame > SLOW_MEDIAN_FRAME_MS || jankRatio > MAX_JANK_FRAME_RATIO);
    };
    handle = requestAnimationFrame(tick);
  });
}

/**
 * Resolve a preference to a level using the static heuristics only.
 *
 * @param preference - User preference.
 * @returns Level and the reason for `low` under `auto`.
 */
export function resolveStaticLevel(preference: EffectsPreference): { level: EffectsLevel; reason: LowPowerReason } {
  if (preference !== 'auto') return { level: preference, reason: null };
  const reason = detectLowEndDevice();
  return { level: reason ? 'low' : 'full', reason };
}

/**
 * Reflect the level on `<html data-effects>` so CSS can switch effects off.
 *
 * @param level - Effective level.
 */
export function applyEffectsLevel(level: EffectsLevel): void {
  document.documentElement.dataset.effects = level;
}
