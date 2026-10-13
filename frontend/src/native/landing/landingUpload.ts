/**
 * Landing-page upload path for the native apps: hand picked files to the
 * native background queue instead of Uppy/TUS inside the WebView.
 */
import { FileNexusNative, enqueueNativeUpload } from '../index';
import type { NativeFile } from '../index';
import { getDeviceUsername } from '../serverConfig';

/**
 * Enqueue picked files for native upload to the signed-in device account.
 *
 * @param files - Files from the native picker.
 * @returns Username the device token belongs to (uploads land there).
 * @throws Error (zh-TW) when the device is not signed in.
 */
export async function enqueueLandingFiles(files: NativeFile[]): Promise<string | null> {
  const config = await FileNexusNative.getConfiguration();
  if (!config.deviceToken) {
    throw new Error('請先到「App 設定」登入此裝置，才能在背景上傳檔案');
  }
  await enqueueNativeUpload(files);
  return getDeviceUsername();
}
