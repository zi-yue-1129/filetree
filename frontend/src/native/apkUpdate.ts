/**
 * Android in-app updater (contract §4): compare `android.json` with the
 * installed `versionCode`, then download, verify and install the APK.
 */
import type { PluginListenerHandle } from '@capacitor/core';
import { FileNexusNative, getNativeErrorCode, getPlatform } from './index';
import { fetchReleaseJson } from './liveUpdate';

/** `android.json` release asset. */
export interface AndroidReleaseManifest {
  version: string;
  versionCode: number;
  url: string;
  sha256: string;
  notes: string;
}

/** Result of {@link checkApkUpdate}. */
export interface ApkUpdateCheck {
  /** Whether the published APK is newer than the installed one. */
  available: boolean;
  /** Installed versionName / versionCode. */
  installedVersion: string;
  installedVersionCode: number;
  /** Published release. */
  latest: AndroidReleaseManifest;
}

/**
 * Validate the manifest shape.
 *
 * @param value - Parsed JSON.
 * @returns Typed manifest.
 */
function asManifest(value: unknown): AndroidReleaseManifest {
  const record = value as Partial<Record<keyof AndroidReleaseManifest, unknown>>;
  if (typeof record.version !== 'string' || typeof record.url !== 'string' || typeof record.sha256 !== 'string') {
    throw new Error('android.json 格式不正確');
  }
  if (typeof record.versionCode !== 'number' || !Number.isInteger(record.versionCode)) {
    throw new Error('android.json 缺少 versionCode');
  }
  return {
    version: record.version,
    versionCode: record.versionCode,
    url: record.url,
    sha256: record.sha256,
    notes: typeof record.notes === 'string' ? record.notes : '',
  };
}

/**
 * Fetch `android.json` and compare it with the installed build.
 *
 * @returns Update availability and both versions.
 */
export async function checkApkUpdate(): Promise<ApkUpdateCheck> {
  if (getPlatform() !== 'android') {
    throw new Error('APK updates are Android-only');
  }
  const [latestRaw, info] = await Promise.all([
    fetchReleaseJson<unknown>('android.json'),
    FileNexusNative.getNativeInfo(),
  ]);
  const latest = asManifest(latestRaw);
  return {
    available: latest.versionCode > info.versionCode,
    installedVersion: info.versionName,
    installedVersionCode: info.versionCode,
    latest,
  };
}

/** Outcome of {@link installApk}. */
export type ApkInstallOutcome = 'installer-opened' | 'permission-required';

/**
 * Download, verify and hand the APK to the system installer. When "install
 * unknown apps" is not allowed yet, opens that settings page and returns
 * `permission-required`; the user then retries.
 *
 * @param manifest - Release to install.
 * @param onProgress - Download progress callback (fraction 0..1, or `null` when unknown).
 * @returns What happened.
 */
export async function installApk(
  manifest: AndroidReleaseManifest,
  onProgress: (fraction: number | null) => void,
): Promise<ApkInstallOutcome> {
  const { allowed } = await FileNexusNative.canInstallPackages();
  if (!allowed) {
    await FileNexusNative.openInstallPermissionSettings();
    return 'permission-required';
  }
  let handle: PluginListenerHandle | null = null;
  try {
    handle = await FileNexusNative.addListener('apkDownloadProgress', (event) => {
      onProgress(event.bytesTotal > 0 ? event.bytesDownloaded / event.bytesTotal : null);
    });
    await FileNexusNative.installApkUpdate({ url: manifest.url, sha256: manifest.sha256, version: manifest.version });
    return 'installer-opened';
  } catch (error: unknown) {
    if (getNativeErrorCode(error) === 'INSTALL_PERMISSION_REQUIRED') {
      await FileNexusNative.openInstallPermissionSettings();
      return 'permission-required';
    }
    if (getNativeErrorCode(error) === 'CHECKSUM_MISMATCH') {
      throw new Error('下載的安裝檔校驗失敗（SHA-256 不符），已取消安裝', { cause: error });
    }
    throw error;
  } finally {
    if (handle) await handle.remove();
  }
}
