/**
 * Web fallback of the `FileNexusNative` plugin.
 *
 * Browsers cannot run background uploads, receive share intents or read the
 * photo library, so those calls reject with `unavailable`. Configuration is
 * kept in `localStorage` so the shared UI code can be exercised in a browser.
 */
import { WebPlugin } from '@capacitor/core';

import type {
  CanInstallPackagesResult,
  ConfigureOptions,
  EnqueueUploadResult,
  FileNexusNativePlugin,
  FileNexusPermissionStatus,
  GetSharedItemsResult,
  GetUploadsResult,
  NativeConfiguration,
  NativeInfo,
  PhotoBackupStatus,
  PickFilesResult,
  PickFolderResult,
  RegisterPushResult,
} from './definitions';

/** `localStorage` key holding the serialized {@link NativeConfiguration}. */
const CONFIG_STORAGE_KEY = 'filenexus_native_config';

/** Browser implementation of {@link FileNexusNativePlugin}. */
export class FileNexusNativeWeb extends WebPlugin implements FileNexusNativePlugin {
  /** Store the configuration in `localStorage`. */
  async configure(options: ConfigureOptions): Promise<void> {
    if (!options.serverUrl) {
      throw new Error('serverUrl is required');
    }
    const config: NativeConfiguration = {
      serverUrl: options.serverUrl,
      deviceToken: options.deviceToken,
      deviceId: options.deviceId ?? null,
      deviceName: options.deviceName ?? null,
    };
    window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  }

  /** Read the configuration stored by {@link configure}. */
  async getConfiguration(): Promise<NativeConfiguration> {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) {
      return { serverUrl: null, deviceToken: null, deviceId: null, deviceName: null };
    }
    // A corrupt value is a real error: surface it instead of resetting silently.
    return JSON.parse(raw) as NativeConfiguration;
  }

  /** Report the web platform. */
  async getNativeInfo(): Promise<NativeInfo> {
    return { platform: 'web', versionName: '0.0.0', versionCode: 0, pushAvailable: false };
  }

  /** Not available: browsers cannot hand out persistent file URIs. */
  async pickFiles(): Promise<PickFilesResult> {
    throw this.unavailable('pickFiles is only available in the native apps');
  }

  /** Not available: browsers use `<input webkitdirectory>` instead. */
  async pickFolder(): Promise<PickFolderResult> {
    throw this.unavailable('pickFolder is only available in the native apps');
  }

  /** Not available: the web app uploads through Uppy/TUS instead. */
  async enqueueUpload(): Promise<EnqueueUploadResult> {
    throw this.unavailable('enqueueUpload is only available in the native apps');
  }

  /** The web fallback never has native upload jobs. */
  async getUploads(): Promise<GetUploadsResult> {
    return { uploads: [] };
  }

  /** Not available on the web. */
  async cancelUpload(): Promise<void> {
    throw this.unavailable('cancelUpload is only available in the native apps');
  }

  /** Nothing to clear on the web. */
  async clearFinishedUploads(): Promise<void> {
    return;
  }

  /** Browsers do not receive OS share-sheet items. */
  async getSharedItems(): Promise<GetSharedItemsResult> {
    return { items: [] };
  }

  /** Nothing to clear on the web. */
  async clearSharedItems(): Promise<void> {
    return;
  }

  /** Not available: browsers cannot read the photo library in the background. */
  async setPhotoBackup(): Promise<PhotoBackupStatus> {
    throw this.unavailable('Photo backup is only available in the native apps');
  }

  /** Not available on the web. */
  async getPhotoBackupStatus(): Promise<PhotoBackupStatus> {
    throw this.unavailable('Photo backup is only available in the native apps');
  }

  /** Not available on the web. */
  async runPhotoBackupNow(): Promise<void> {
    throw this.unavailable('Photo backup is only available in the native apps');
  }

  /** Not available on the web. */
  async registerPush(): Promise<RegisterPushResult> {
    throw this.unavailable('Push is only available in the native apps');
  }

  /** Browsers never install packages. */
  async canInstallPackages(): Promise<CanInstallPackagesResult> {
    return { allowed: false };
  }

  /** Not available on the web. */
  async openInstallPermissionSettings(): Promise<void> {
    throw this.unavailable('Only available on Android');
  }

  /** Not available on the web. */
  async installApkUpdate(): Promise<void> {
    throw this.unavailable('Only available on Android');
  }

  /** Browsers grant neither permission to this plugin. */
  async checkPermissions(): Promise<FileNexusPermissionStatus> {
    return { photos: 'denied', notifications: 'denied' };
  }

  /** Same as {@link checkPermissions} on the web. */
  async requestPermissions(): Promise<FileNexusPermissionStatus> {
    return this.checkPermissions();
  }
}
