/**
 * Public origin of the web frontend, for links meant for other people
 * (share links, folder links, QR codes).
 *
 * Inside the native shells the page origin is the WebView's private origin
 * (`https://localhost` on Android, `capacitor://localhost` on iOS,
 * `tauri://localhost` / `http://tauri.localhost` on desktop), so links built
 * from `window.location.origin` would not work for anyone else.
 */
import { API_ORIGIN } from './api';
import { isNativeApp } from '../native';

/** Raised when a native build cannot tell which public URL links should use. */
export class PublicSiteOriginError extends Error {
  /**
   * @param message - Message shown to the user.
   */
  constructor(message: string) {
    super(message);
    this.name = 'PublicSiteOriginError';
  }
}

/**
 * Normalise an absolute http(s) URL to its origin.
 *
 * @param rawUrl - URL such as `https://99.spkuan.cc/`.
 * @param source - Name of the setting, for the error message.
 * @returns Origin without trailing slash.
 * @throws PublicSiteOriginError when the URL is not absolute http(s).
 */
function toOrigin(rawUrl: string, source: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (error: unknown) {
    throw new PublicSiteOriginError(`${source} 不是有效的網址：${rawUrl}（${String(error)}）`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new PublicSiteOriginError(`${source} 必須是 http(s) 網址：${rawUrl}`);
  }
  return parsed.origin;
}

/**
 * Build-time public site origin (`VITE_SITE_URL`).
 *
 * @returns Origin without trailing slash, or `null` when the build did not set it.
 * @throws PublicSiteOriginError when the value is set but invalid.
 */
export function configuredSiteOrigin(): string | null {
  const rawSiteUrl: string | undefined = import.meta.env.VITE_SITE_URL || undefined;
  return rawSiteUrl ? toOrigin(rawSiteUrl, 'VITE_SITE_URL') : null;
}

/**
 * Backend origin the build was made for (before any runtime override).
 *
 * @returns Origin without trailing slash.
 */
function buildTimeApiOrigin(): string {
  return (import.meta.env.VITE_API_BASE_URL || window.location.origin).replace(/\/+$/, '');
}

/**
 * Public origin of the web frontend that links for other people must use.
 *
 * - Web: the page origin, so Cloudflare Pages, preview deployments and the
 *   backend-served SPA (self-hosted) each link to themselves.
 * - Native app pointed at another server (Settings server override): that
 *   server's origin. A self-hosted backend serves the SPA itself, and the
 *   build-time site could not resolve another server's share tokens.
 * - Native app on the default server: build-time `VITE_SITE_URL`.
 *
 * @returns Origin without trailing slash.
 * @throws PublicSiteOriginError in a native build without `VITE_SITE_URL`
 * (instead of silently producing an unusable `localhost` link).
 */
export function publicSiteOrigin(): string {
  if (!isNativeApp()) {
    return window.location.origin;
  }
  if (API_ORIGIN !== buildTimeApiOrigin()) {
    return toOrigin(API_ORIGIN, '伺服器網址');
  }
  const siteOrigin = configuredSiteOrigin();
  if (siteOrigin === null) {
    throw new PublicSiteOriginError(
      '此 App 版本未設定公開網站網址（VITE_SITE_URL），無法產生可分享的連結。請更新 App 或改用網頁版分享。',
    );
  }
  return siteOrigin;
}

/**
 * Absolute public URL for an app path.
 *
 * @param path - Path starting with `/`, optionally with query and hash.
 * @returns Absolute URL on {@link publicSiteOrigin}.
 * @throws PublicSiteOriginError see {@link publicSiteOrigin}.
 */
export function publicSiteUrl(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`publicSiteUrl expects an absolute path, got "${path}"`);
  }
  return `${publicSiteOrigin()}${path}`;
}
