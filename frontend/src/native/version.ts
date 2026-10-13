/**
 * Version helpers shared by the live-update and APK-update checks.
 */

/** Release asset base URL (contract §4). */
export const RELEASE_DOWNLOAD_BASE = 'https://github.com/zi-yue-1129/filetree/releases/latest/download';

/**
 * Version of this web bundle, injected by CI as `VITE_APP_VERSION` (X.Y.Z).
 * Local builds report `0.0.0`, so any published bundle counts as newer.
 */
export const WEB_BUNDLE_VERSION: string = import.meta.env.VITE_APP_VERSION || '0.0.0';

/**
 * Parse an `X.Y.Z` (optionally `vX.Y.Z`) version.
 *
 * @param version - Version string.
 * @returns `[major, minor, patch]`.
 * @throws Error when the string is not a three-part numeric version.
 */
export function parseVersion(version: string): [number, number, number] {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) {
    throw new Error(`Invalid version "${version}" (expected X.Y.Z)`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Compare two `X.Y.Z` versions.
 *
 * @param a - First version.
 * @param b - Second version.
 * @returns Negative if `a < b`, 0 if equal, positive if `a > b`.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}
