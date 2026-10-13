/**
 * Platform detection and typed wrappers around the `FileNexusNative` plugin.
 *
 * Everything the web UI needs from native code goes through this module so
 * pages never import Capacitor directly. On the plain web build every helper
 * degrades to a no-op or a clear "unavailable" error.
 */
import { Capacitor } from '@capacitor/core';
import { FileNexusNative } from 'filenexus-native';
import type {
  EnqueueUploadResult,
  FileNexusErrorCode,
  NativeConfiguration,
  NativeFile,
  PhotoBackupOptions,
  PhotoBackupStatus,
  SharedItem,
  UploadJob,
  UploadProgressEvent,
} from 'filenexus-native';
import type { PluginListenerHandle } from '@capacitor/core';

export { FileNexusNative };
export type {
  EnqueueUploadResult,
  FileNexusErrorCode,
  NativeConfiguration,
  NativeFile,
  PhotoBackupOptions,
  PhotoBackupStatus,
  SharedItem,
  UploadJob,
  UploadProgressEvent,
};

/** Runtime platform of the UI. */
export type AppPlatform = 'web' | 'android' | 'ios' | 'desktop';

/** Shape of the Tauri global injected into desktop WebViews. */
interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
}

/**
 * Detect the platform the UI is running on.
 *
 * @returns `'android'`/`'ios'` inside the Capacitor shells, `'desktop'` inside
 * the Tauri shell, otherwise `'web'`.
 */
export function getPlatform(): AppPlatform {
  if (Capacitor.isNativePlatform()) {
    const platform = Capacitor.getPlatform();
    if (platform === 'android' || platform === 'ios') {
      return platform;
    }
    throw new Error(`Unsupported Capacitor platform: ${platform}`);
  }
  if ((window as TauriWindow).__TAURI_INTERNALS__ !== undefined) {
    return 'desktop';
  }
  return 'web';
}

/**
 * Whether the UI runs inside the Android or iOS Capacitor shell.
 *
 * @returns `true` on Android/iOS.
 */
export function isMobileNative(): boolean {
  const platform = getPlatform();
  return platform === 'android' || platform === 'ios';
}

/**
 * Whether the UI runs inside any native shell (mobile or desktop).
 *
 * @returns `true` unless running in a plain browser.
 */
export function isNativeApp(): boolean {
  return getPlatform() !== 'web';
}

/**
 * Extract the stable plugin error code from a rejected plugin call.
 *
 * @param error - Value caught from a rejected `FileNexusNative` call.
 * @returns The {@link FileNexusErrorCode} (or Capacitor's own code such as
 * `UNIMPLEMENTED`), or `null` when the error carries none.
 */
export function getNativeErrorCode(error: unknown): FileNexusErrorCode | string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/**
 * Human-readable message for any error thrown by a plugin call.
 *
 * @param error - Caught value.
 * @returns Message suitable for showing in the UI.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * Queue files for background native TUS upload.
 *
 * @param files - Files with native URIs (from {@link pickNativeFiles} or the share sheet).
 * @param folderId - Optional destination folder id.
 * @returns Job ids, one per file.
 */
export async function enqueueNativeUpload(
  files: NativeFile[],
  folderId?: string,
): Promise<EnqueueUploadResult> {
  return FileNexusNative.enqueueUpload({ files, folderId });
}

/**
 * Open the system file picker.
 *
 * @param multiple - Allow multiple selection.
 * @returns Picked files, or an empty list if the user cancelled.
 */
export async function pickNativeFiles(multiple = true): Promise<NativeFile[]> {
  try {
    const result = await FileNexusNative.pickFiles({ multiple });
    return result.files;
  } catch (error: unknown) {
    if (getNativeErrorCode(error) === 'CANCELLED') {
      return [];
    }
    throw error;
  }
}

/** Outcome of {@link pickNativeFolder}. */
export interface NativeFolderPick {
  /** Display name of the picked folder. */
  folderName: string;
  /** Files below the folder, each with `relativePath` starting at `folderName`. */
  files: NativeFile[];
  /** Entries the platform could not upload and left out. */
  skippedCount: number;
}

/**
 * Open the system folder picker (Android SAF tree / iOS folder picker).
 *
 * @returns The picked folder's files, or `null` if the user cancelled.
 * @throws Error (zh-TW) when the installed app predates folder upload, or the
 * plugin's own error for any other failure.
 */
export async function pickNativeFolder(): Promise<NativeFolderPick | null> {
  try {
    return await FileNexusNative.pickFolder();
  } catch (error: unknown) {
    const code = getNativeErrorCode(error);
    if (code === 'CANCELLED') {
      return null;
    }
    if (code === 'UNIMPLEMENTED') {
      // A live-updated web bundle can run inside an older native shell.
      throw new Error('此 App 版本不支援上傳資料夾，請先到「App 設定」更新 App', { cause: error });
    }
    throw error;
  }
}

/**
 * List native upload jobs, newest first.
 *
 * @returns All jobs known to the native queue.
 */
export async function getNativeUploads(): Promise<UploadJob[]> {
  const result = await FileNexusNative.getUploads();
  return result.uploads;
}

/**
 * Subscribe to native upload progress.
 *
 * @param listener - Called for every progress or state change.
 * @returns Handle; call `remove()` to unsubscribe.
 */
export async function onUploadProgress(
  listener: (event: UploadProgressEvent) => void,
): Promise<PluginListenerHandle> {
  return FileNexusNative.addListener('uploadProgress', listener);
}

/**
 * Read native credentials.
 *
 * @returns The persisted configuration.
 */
export async function getNativeConfiguration(): Promise<NativeConfiguration> {
  return FileNexusNative.getConfiguration();
}
