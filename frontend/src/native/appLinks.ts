/**
 * Android App Links (and, later, iOS Universal Links): `https://<site>/...`
 * links opened from other apps start or resume this app; route them in the
 * bundled SPA.
 *
 * Loaded dynamically from {@link initNative} before the first render, so the
 * cold-start link becomes the initial location of the router and links that
 * arrive while running are never missed by a late-mounting component.
 */
import { App } from '@capacitor/app';
import { configuredSiteOrigin } from '../services/publicSite';
import { deliverAppLink } from './appLinkBus';

/** sessionStorage key of the launch URL already routed in this app process. */
const HANDLED_LAUNCH_URL_KEY = 'filenexus.handledLaunchUrl';

/**
 * In-app path of a link on the public site.
 *
 * @param url - Link opened by the system, e.g. `https://99.spkuan.cc/share/x`.
 * @param siteOrigin - Public site origin the app links are declared for.
 * @returns Path with query and hash, or `null` for other origins or invalid URLs.
 */
export function appLinkPath(url: string, siteOrigin: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error: unknown) {
    console.warn(`Ignoring malformed app link "${url}"`, error);
    return null;
  }
  if (parsed.origin !== siteOrigin) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Route the launch link (cold start) and listen for links while running.
 *
 * The launch URL is applied with `history.replaceState` so the router starts
 * there. It is remembered in sessionStorage, which lives as long as the app
 * process: reloads (live update, server change) keep the current page
 * instead of jumping back to the link that started the app.
 *
 * @throws Error when the Capacitor App plugin calls fail.
 */
export async function initAppLinks(): Promise<void> {
  const siteOrigin = configuredSiteOrigin();
  if (siteOrigin === null) {
    console.error('VITE_SITE_URL is not set in this build: links to the website cannot be routed in the app');
    return;
  }
  await App.addListener('appUrlOpen', ({ url }) => {
    const path = appLinkPath(url, siteOrigin);
    if (path === null) {
      console.warn(`Ignoring app link outside ${siteOrigin}: ${url}`);
      return;
    }
    deliverAppLink(path);
  });

  const launch = await App.getLaunchUrl();
  const launchUrl = launch?.url;
  if (!launchUrl || sessionStorage.getItem(HANDLED_LAUNCH_URL_KEY) === launchUrl) return;
  sessionStorage.setItem(HANDLED_LAUNCH_URL_KEY, launchUrl);
  const path = appLinkPath(launchUrl, siteOrigin);
  if (path === null) {
    console.warn(`Ignoring launch link outside ${siteOrigin}: ${launchUrl}`);
    return;
  }
  window.history.replaceState(window.history.state, '', path);
}
