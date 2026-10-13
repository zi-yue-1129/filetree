/**
 * Native startup work that must happen before React renders.
 */
import { isMobileNative } from './index';
import { markBundleReady } from './liveUpdate';
import { applyStoredServerUrl } from './serverConfig';

/**
 * Apply the stored server URL and confirm the live-update bundle booted.
 * No-op on the web and desktop builds.
 */
export async function initNative(): Promise<void> {
  if (!isMobileNative()) return;
  await applyStoredServerUrl();
  await markBundleReady();
}
