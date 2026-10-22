/**
 * Landing-page upload path for the native apps: hand picked files to the
 * native background queue instead of Uppy/TUS inside the WebView.
 */
import { FileNexusNative, enqueueNativeUpload } from '../index';
import type { NativeFile } from '../index';
import { getDeviceUsername } from '../serverConfig';

/** Outcome of {@link enqueueLandingFiles}. */
export interface LandingEnqueueResult {
  /** Username the device token belongs to (uploads land there), if known. */
  username: string | null;
  /** Native queue job ids, one per file, in input order. */
  jobIds: string[];
}

/**
 * Enqueue picked files for native upload to the signed-in device account.
 *
 * @param files - Files from the native picker.
 * @returns Device account and the created job ids.
 * @throws Error (zh-TW) when the device is not signed in.
 */
export async function enqueueLandingFiles(files: NativeFile[]): Promise<LandingEnqueueResult> {
  const config = await FileNexusNative.getConfiguration();
  if (!config.deviceToken) {
    throw new Error('請先到「App 設定」登入此裝置，才能在背景上傳檔案');
  }
  const { jobIds } = await enqueueNativeUpload(files);
  return { username: await getDeviceUsername(), jobIds };
}
