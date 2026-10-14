/**
 * TypeScript API of the `FileNexusNative` Capacitor plugin.
 *
 * This file is the client-side half of docs/NATIVE_APPS.md section 5. Android
 * (`android/`) and iOS (`ios/`) implement every method; the web fallback
 * (`web.ts`) implements what a browser can and rejects the rest with
 * `unavailable`/`unimplemented`.
 *
 * Error convention: rejected calls carry a stable `code` (see
 * {@link FileNexusErrorCode}) so the UI can react without parsing messages.
 */
import type { PermissionState, PluginListenerHandle } from '@capacitor/core';

/** Stable error codes used when a plugin call rejects. */
export type FileNexusErrorCode =
  /** `configure()` has not been called with a device token yet. */
  | 'NOT_CONFIGURED'
  /** Push is not configured in this build (no `google-services.json`). */
  | 'PUSH_NOT_CONFIGURED'
  /** A runtime permission the call needs was denied. */
  | 'PERMISSION_DENIED'
  /** Android: the user must allow "install unknown apps" for FileNexus. */
  | 'INSTALL_PERMISSION_REQUIRED'
  /** A downloaded file did not match the expected SHA-256 checksum. */
  | 'CHECKSUM_MISMATCH'
  /** The referenced upload job does not exist. */
  | 'JOB_NOT_FOUND'
  /** Arguments were missing or malformed. */
  | 'INVALID_ARGUMENT'
  /** The user cancelled a picker or prompt. */
  | 'CANCELLED'
  /** Any other I/O or network failure; see the message for details. */
  | 'IO_ERROR';

/** Lifecycle state of a native upload job. */
export type UploadState =
  /** Persisted and waiting for constraints (network, Wi-Fi) or a free slot. */
  | 'queued'
  /** Bytes are being sent. */
  | 'uploading'
  /** Waiting before an automatic retry (exponential backoff). */
  | 'retrying'
  /** The server acknowledged the final byte. */
  | 'completed'
  /** Gave up after the maximum number of attempts or a non-retryable error. */
  | 'failed'
  /** Cancelled via {@link FileNexusNativePlugin.cancelUpload}. */
  | 'cancelled';

/** Where an upload job came from. */
export type UploadSource = 'app' | 'share' | 'backup';

/** Options for {@link FileNexusNativePlugin.configure}. */
export interface ConfigureOptions {
  /** Server origin, e.g. `https://files.example.com` (no trailing `/api`). */
  serverUrl: string;
  /**
   * Long-lived device token from `POST /api/devices/register`, or `null` to
   * sign the device out (pending uploads stay queued but will not start).
   */
  deviceToken: string | null;
  /** `device_id` returned by `POST /api/devices/register`. */
  deviceId?: string | null;
  /** Human-readable device name sent at registration (used for backups). */
  deviceName?: string | null;
}

/** Credentials persisted natively, as returned by {@link FileNexusNativePlugin.getConfiguration}. */
export interface NativeConfiguration {
  /** Configured server origin, or `null` when never configured. */
  serverUrl: string | null;
  /** Stored device token, or `null` when signed out. */
  deviceToken: string | null;
  /** Stored device id, or `null` when signed out. */
  deviceId: string | null;
  /** Stored device name, or `null` when signed out. */
  deviceName: string | null;
}

/** A local file reference that native code can read in the background. */
export interface NativeFile {
  /**
   * Platform URI: Android `content://` or `file://`; iOS `file://` inside the
   * app (or app-group) container.
   */
  uri: string;
  /** File name to use on the server (may contain `/` only via `relativePath`). */
  name: string;
  /** MIME type; `application/octet-stream` when unknown. */
  mimeType: string;
  /** Size in bytes when known, `-1` otherwise. */
  size?: number;
  /** Optional folder-relative path (`a/b/c.txt`) sent as TUS `relativePath`. */
  relativePath?: string;
  /** Optional last-modified time in epoch milliseconds (TUS `lastModified`). */
  lastModified?: number;
}

/** Options for {@link FileNexusNativePlugin.pickFiles}. */
export interface PickFilesOptions {
  /** Allow selecting more than one file. Default `true`. */
  multiple?: boolean;
  /** MIME filters, e.g. `['image/*', 'video/*']`. Default: any type. */
  mimeTypes?: string[];
}

/** Result of {@link FileNexusNativePlugin.pickFiles}. */
export interface PickFilesResult {
  /** Picked files with read access that survives app restarts. */
  files: NativeFile[];
}

/** Result of {@link FileNexusNativePlugin.pickFolder}. */
export interface PickFolderResult {
  /** Display name of the picked folder (first segment of every `relativePath`). */
  folderName: string;
  /**
   * Every regular file below the folder, recursively, sorted by path. Each
   * carries `relativePath` = `<folderName>/<sub dirs>/<name>`, the same shape
   * the web uploader sends from `webkitRelativePath`.
   */
  files: NativeFile[];
  /**
   * Entries that cannot be uploaded and were left out (Android: virtual
   * documents such as Google Docs, or directory cycles; iOS: unreadable items).
   */
  skippedCount: number;
}

/** Options for {@link FileNexusNativePlugin.enqueueUpload}. */
export interface EnqueueUploadOptions {
  /** Files to upload; each becomes one job. */
  files: NativeFile[];
  /** Destination folder id (TUS `folder_id`); root when omitted. */
  folderId?: string;
}

/** Result of {@link FileNexusNativePlugin.enqueueUpload}. */
export interface EnqueueUploadResult {
  /** One job id per input file, in the same order. */
  jobIds: string[];
}

/** Snapshot of one native upload job. */
export interface UploadJob {
  /** Stable job id (survives process death). */
  jobId: string;
  /** File name shown to the user. */
  name: string;
  /** MIME type sent as TUS `filetype`. */
  mimeType: string;
  /** Destination folder id, if any. */
  folderId: string | null;
  /** Origin of the job. */
  source: UploadSource;
  /** Current state. */
  state: UploadState;
  /** Bytes acknowledged by the server. */
  bytesSent: number;
  /** Total bytes, `-1` when unknown. */
  bytesTotal: number;
  /** Last error message for `failed`/`retrying` jobs, else `null`. */
  error: string | null;
  /** Creation time, epoch milliseconds. */
  createdAt: number;
  /** Last state change, epoch milliseconds. */
  updatedAt: number;
}

/** Result of {@link FileNexusNativePlugin.getUploads}. */
export interface GetUploadsResult {
  /** All known jobs, newest first. */
  uploads: UploadJob[];
}

/** Options identifying one upload job. */
export interface JobIdOptions {
  /** Job id from {@link EnqueueUploadResult.jobIds}. */
  jobId: string;
}

/** Payload of the `uploadProgress` event. */
export interface UploadProgressEvent {
  /** Job the event refers to. */
  jobId: string;
  /** Bytes acknowledged by the server. */
  bytesSent: number;
  /** Total bytes, `-1` when unknown. */
  bytesTotal: number;
  /** Current state. */
  state: UploadState;
  /** Error message when `state` is `failed` or `retrying`. */
  error?: string | null;
}

/** A file received from the OS share sheet that has not been uploaded yet. */
export interface SharedItem extends NativeFile {
  /** Unique id of the shared item. */
  id: string;
  /** Time it was received, epoch milliseconds. */
  receivedAt: number;
}

/** Result of {@link FileNexusNativePlugin.getSharedItems}. */
export interface GetSharedItemsResult {
  /** Items waiting for the user (only when no device token was configured). */
  items: SharedItem[];
}

/** Payload of the `sharedItems` event. */
export interface SharedItemsEvent {
  /** Newly received items that still need user action. */
  items: SharedItem[];
  /** Job ids when the items were enqueued automatically (device configured). */
  enqueuedJobIds: string[];
}

/** Options for {@link FileNexusNativePlugin.setPhotoBackup}. */
export interface PhotoBackupOptions {
  /** Turn automatic photo/video backup on or off. */
  enabled: boolean;
  /** Upload only on unmetered (Wi-Fi) networks. */
  wifiOnly: boolean;
  /** Back up videos as well as photos. */
  includeVideos: boolean;
}

/** Photo library access level. `limited` = Android 14+ / iOS partial access. */
export type PhotoAccess = PermissionState | 'limited';

/** Result of {@link FileNexusNativePlugin.getPhotoBackupStatus}. */
export interface PhotoBackupStatus extends PhotoBackupOptions {
  /** Current photo library permission. */
  permission: PhotoAccess;
  /** Server folder id from `POST /api/backup/folder`, once resolved. */
  folderId: string | null;
  /** Last completed scan, epoch milliseconds, or `null`. */
  lastRunAt: number | null;
  /** Newest media timestamp already enqueued, epoch milliseconds, or `null`. */
  lastBackedUpAt: number | null;
  /** Number of media items enqueued by backup since it was enabled. */
  enqueuedCount: number;
  /** Last error encountered by the backup scan, or `null`. */
  lastError: string | null;
}

/** Result of {@link FileNexusNativePlugin.registerPush}. */
export interface RegisterPushResult {
  /**
   * FCM registration token (Android), or `null` on iOS where only local
   * notifications from the WebSocket are used.
   */
  token: string | null;
}

/** Payload of the `pushReceived` event (message received while in foreground). */
export interface PushReceivedEvent {
  /** Event type from the backend data payload, e.g. `files_added`. */
  type: string;
  /** Raw data payload. */
  data: Record<string, string>;
}

/** Options for {@link FileNexusNativePlugin.installApkUpdate}. */
export interface InstallApkOptions {
  /** HTTPS URL of `FileNexus-<ver>.apk`. */
  url: string;
  /** Expected lowercase hex SHA-256 of the APK. */
  sha256: string;
  /** Version string, used for the cached file name and notification. */
  version: string;
}

/** Payload of the `apkDownloadProgress` event. */
export interface ApkDownloadProgressEvent {
  /** Bytes downloaded so far. */
  bytesDownloaded: number;
  /** Total bytes, `-1` when unknown. */
  bytesTotal: number;
}

/** Result of {@link FileNexusNativePlugin.canInstallPackages}. */
export interface CanInstallPackagesResult {
  /** Whether the app may launch the package installer. */
  allowed: boolean;
}

/** Native app identity, see {@link FileNexusNativePlugin.getNativeInfo}. */
export interface NativeInfo {
  /** Platform the plugin runs on. */
  platform: 'android' | 'ios' | 'web';
  /** Native version name, e.g. `1.2.3`. */
  versionName: string;
  /** Android `versionCode` / iOS build number as an integer (0 on web). */
  versionCode: number;
  /** Whether push support is compiled in and configured (Android FCM). */
  pushAvailable: boolean;
}

/** Runtime permissions the plugin manages via `checkPermissions`/`requestPermissions`. */
export interface FileNexusPermissionStatus {
  /** Photo/video library read access for backup. */
  photos: PhotoAccess;
  /** Posting notifications (Android 13+, iOS). */
  notifications: PermissionState;
}

/** Permission aliases accepted by `requestPermissions`. */
export type FileNexusPermissionType = 'photos' | 'notifications';

/** Options for `requestPermissions`. */
export interface FileNexusPermissionRequest {
  /** Which permissions to request; all when omitted. */
  permissions?: FileNexusPermissionType[];
}

/** The `FileNexusNative` Capacitor plugin. */
export interface FileNexusNativePlugin {
  /**
   * Persist server URL and device credentials natively so background work
   * (uploads, share target, photo backup, push token sync) survives app kill.
   * Passing `deviceToken: null` signs the device out.
   */
  configure(options: ConfigureOptions): Promise<void>;

  /** Read the credentials persisted by {@link configure}. */
  getConfiguration(): Promise<NativeConfiguration>;

  /** Native app version and capabilities. */
  getNativeInfo(): Promise<NativeInfo>;

  /**
   * Open the system document picker and return files with persistent read
   * access, suitable for {@link enqueueUpload}. Rejects with `CANCELLED` when
   * the user dismisses the picker.
   */
  pickFiles(options?: PickFilesOptions): Promise<PickFilesResult>;

  /**
   * Open the system folder picker and return every file below the chosen
   * folder with its folder-relative path, suitable for {@link enqueueUpload}
   * (the server recreates the folder structure from `relativePath`).
   * Android: Storage Access Framework tree with a persisted read grant.
   * iOS: files are copied into app storage like {@link pickFiles}.
   * Rejects with `CANCELLED` when the user dismisses the picker.
   */
  pickFolder(): Promise<PickFolderResult>;

  /**
   * Queue native TUS uploads (background, resumable, retried with backoff,
   * local notification on finish/failure). Rejects with `NOT_CONFIGURED`
   * when no device token is stored.
   */
  enqueueUpload(options: EnqueueUploadOptions): Promise<EnqueueUploadResult>;

  /** List known upload jobs (active and recently finished). */
  getUploads(): Promise<GetUploadsResult>;

  /** Cancel a queued or running upload and terminate it on the server. */
  cancelUpload(options: JobIdOptions): Promise<void>;

  /** Forget all `completed`, `failed` and `cancelled` jobs. */
  clearFinishedUploads(): Promise<void>;

  /**
   * Files received from the OS share sheet that still need user action
   * (only populated while no device token is configured).
   */
  getSharedItems(): Promise<GetSharedItemsResult>;

  /** Delete pending shared items (and their copied files) by id; all when omitted. */
  clearSharedItems(options?: { ids?: string[] }): Promise<void>;

  /**
   * Enable/disable automatic photo/video backup into `相簿備份/<device>`.
   * Enabling requests the photo permission if needed and resolves with the
   * resulting status (backup stays disabled when permission is denied).
   */
  setPhotoBackup(options: PhotoBackupOptions): Promise<PhotoBackupStatus>;

  /** Current photo backup settings, permission and progress. */
  getPhotoBackupStatus(): Promise<PhotoBackupStatus>;

  /** Run a photo backup scan now instead of waiting for the next trigger. */
  runPhotoBackupNow(): Promise<void>;

  /**
   * Register for remote push. Android: returns the FCM token and syncs it to
   * the server via `PATCH /api/devices/{id}`; rejects with
   * `PUSH_NOT_CONFIGURED` in builds without Firebase. iOS: `{token: null}`.
   */
  registerPush(): Promise<RegisterPushResult>;

  /** Android: whether "install unknown apps" is granted for this app. */
  canInstallPackages(): Promise<CanInstallPackagesResult>;

  /** Android: open the system "install unknown apps" settings screen. */
  openInstallPermissionSettings(): Promise<void>;

  /**
   * Android: download an APK (emitting `apkDownloadProgress`), verify its
   * SHA-256 and launch the system installer. Rejects with
   * `INSTALL_PERMISSION_REQUIRED` or `CHECKSUM_MISMATCH` as appropriate.
   */
  installApkUpdate(options: InstallApkOptions): Promise<void>;

  /** Check photo and notification permissions. */
  checkPermissions(): Promise<FileNexusPermissionStatus>;

  /** Request photo and/or notification permissions. */
  requestPermissions(options?: FileNexusPermissionRequest): Promise<FileNexusPermissionStatus>;

  /** Upload progress and state changes (only while the WebView is alive). */
  addListener(
    eventName: 'uploadProgress',
    listener: (event: UploadProgressEvent) => void,
  ): Promise<PluginListenerHandle>;

  /** New share-sheet items arrived while the app is running. */
  addListener(
    eventName: 'sharedItems',
    listener: (event: SharedItemsEvent) => void,
  ): Promise<PluginListenerHandle>;

  /** Push message received while the app is in the foreground. */
  addListener(
    eventName: 'pushReceived',
    listener: (event: PushReceivedEvent) => void,
  ): Promise<PluginListenerHandle>;

  /** APK download progress for {@link installApkUpdate}. */
  addListener(
    eventName: 'apkDownloadProgress',
    listener: (event: ApkDownloadProgressEvent) => void,
  ): Promise<PluginListenerHandle>;

  /** Remove every listener registered on this plugin. */
  removeAllListeners(): Promise<void>;
}
