/**
 * Display formatting helpers for the native Settings page.
 */

/**
 * Format a byte count for display.
 *
 * @param bytes - Byte count (negative = unknown).
 * @returns e.g. `12.3 MB` or `?`.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 0) return '?';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Format an epoch-millisecond timestamp in zh-TW.
 *
 * @param millis - Timestamp or `null`.
 * @returns Localised date/time or `—`.
 */
export function formatTime(millis: number | null): string {
  return millis === null ? '—' : new Date(millis).toLocaleString('zh-TW');
}
