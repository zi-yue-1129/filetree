/**
 * Live web-bundle updates for Android/iOS via `@capgo/capacitor-updater` in
 * self-hosted manual mode (contract §4): check `web-bundle.json`, respect
 * `minNativeVersion`, download in the background, apply on next start.
 */
import { App } from '@capacitor/app';
import { CapacitorHttp } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { isMobileNative } from './index';
import { RELEASE_DOWNLOAD_BASE, WEB_BUNDLE_VERSION, compareVersions } from './version';

/** `web-bundle.json` release asset. */
export interface WebBundleManifest {
  version: string;
  url: string;
  sha256: string;
  minNativeVersion: string;
}

/** Result of {@link checkWebBundleUpdate}. */
export type WebBundleCheck =
  | { status: 'up-to-date'; current: string; latest: string }
  | { status: 'needs-native-update'; current: string; latest: string; minNativeVersion: string }
  | { status: 'scheduled'; current: string; latest: string };

/**
 * Tell Capgo the running bundle booted fine (otherwise it rolls back after
 * `appReadyTimeout`). Must run on every start of a native build.
 */
export async function markBundleReady(): Promise<void> {
  if (!isMobileNative()) return;
  await CapacitorUpdater.notifyAppReady();
}

/**
 * Fetch a JSON release asset through the native HTTP stack (GitHub release
 * downloads do not send CORS headers, so WebView `fetch` would fail).
 *
 * @param asset - Asset file name.
 * @returns Parsed JSON body.
 */
export async function fetchReleaseJson<T>(asset: string): Promise<T> {
  const response = await CapacitorHttp.get({
    url: `${RELEASE_DOWNLOAD_BASE}/${asset}`,
    headers: { Accept: 'application/json' },
    responseType: 'json',
    connectTimeout: 15000,
    readTimeout: 15000,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`下載 ${asset} 失敗：HTTP ${response.status}`);
  }
  const data: unknown = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  return data as T;
}

/**
 * Validate the manifest shape.
 *
 * @param value - Parsed JSON.
 * @returns Typed manifest.
 */
function asManifest(value: unknown): WebBundleManifest {
  const record = value as Partial<Record<keyof WebBundleManifest, unknown>>;
  for (const key of ['version', 'url', 'sha256', 'minNativeVersion'] as const) {
    if (typeof record[key] !== 'string' || record[key] === '') {
      throw new Error(`web-bundle.json 缺少欄位 ${key}`);
    }
  }
  return record as WebBundleManifest;
}

/**
 * Check for a newer web bundle and, if compatible with this native shell,
 * download it and schedule it for the next app start.
 *
 * @returns What happened.
 */
export async function checkWebBundleUpdate(): Promise<WebBundleCheck> {
  if (!isMobileNative()) {
    throw new Error('Live update is only available in the mobile apps');
  }
  const manifest = asManifest(await fetchReleaseJson<unknown>('web-bundle.json'));
  const current = WEB_BUNDLE_VERSION;
  if (compareVersions(manifest.version, current) <= 0) {
    return { status: 'up-to-date', current, latest: manifest.version };
  }
  const nativeVersion = (await App.getInfo()).version;
  if (compareVersions(nativeVersion, manifest.minNativeVersion) < 0) {
    return { status: 'needs-native-update', current, latest: manifest.version, minNativeVersion: manifest.minNativeVersion };
  }
  const { bundles } = await CapacitorUpdater.list();
  const existing = bundles.find((bundle) => bundle.version === manifest.version && bundle.status !== 'error');
  const bundle = existing ?? await CapacitorUpdater.download({
    url: manifest.url,
    version: manifest.version,
    checksum: manifest.sha256,
  });
  await CapacitorUpdater.next({ id: bundle.id });
  return { status: 'scheduled', current, latest: manifest.version };
}
