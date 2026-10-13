/**
 * Native startup work that must happen before React renders.
 */
import { isMobileNative } from './index';
import { applyStoredServerUrl } from './serverConfig';

/**
 * Apply the stored server URL and confirm the live-update bundle booted.
 * No-op on the web and desktop builds.
 *
 * The live-update module (and the Capgo updater plugin it wraps) is imported
 * dynamically so web visitors never download it.
 */
export async function initNative(): Promise<void> {
  if (!isMobileNative()) return;
  await applyStoredServerUrl();
  const { markBundleReady } = await import('./liveUpdate');
  await markBundleReady();
}
