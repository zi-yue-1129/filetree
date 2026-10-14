/**
 * Native startup work that must happen before React renders.
 */
import { isMobileNative } from './index';
import { applyStoredServerUrl } from './serverConfig';

/**
 * Apply the stored server URL, confirm the live-update bundle booted and
 * start App Link routing. No-op on the web and desktop builds.
 *
 * The live-update and App Link modules (and the Capacitor plugins they wrap)
 * are imported dynamically so web visitors never download them. The bundle is
 * marked ready before App Links are set up so an App Link failure can never
 * make Capgo roll back a working bundle.
 */
export async function initNative(): Promise<void> {
  if (!isMobileNative()) return;
  await applyStoredServerUrl();
  const { markBundleReady } = await import('./liveUpdate');
  await markBundleReady();
  const { initAppLinks } = await import('./appLinks');
  await initAppLinks();
}
