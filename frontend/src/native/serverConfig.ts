/**
 * Runtime server URL override for the native apps (contract §1), persisted in
 * Capacitor Preferences and applied to `services/api.ts` before rendering.
 */
import { Preferences } from '@capacitor/preferences';
import { getDefaultApiOrigin, setApiOrigin, API_ORIGIN } from '../services/api';

const SERVER_URL_KEY = 'filenexus.serverUrl';
const DEVICE_USERNAME_KEY = 'filenexus.deviceUsername';

/**
 * Validate and normalise a user-entered server URL.
 *
 * @param input - Raw text, e.g. `https://files.example.com/`.
 * @returns Origin without trailing slash.
 * @throws Error with a zh-TW message when the URL is not http(s).
 */
export function normaliseServerUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch (error: unknown) {
    throw new Error(`網址格式不正確：${input}`, { cause: error });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('伺服器網址必須以 https:// 或 http:// 開頭');
  }
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
}

/**
 * Load the stored override and apply it to the API module.
 *
 * @returns The stored override, or `null` when the build default is used.
 */
export async function applyStoredServerUrl(): Promise<string | null> {
  const { value } = await Preferences.get({ key: SERVER_URL_KEY });
  setApiOrigin(value);
  return value;
}

/**
 * Persist (or clear) the override. Callers must reload the page so every
 * module and open socket picks up the new origin.
 *
 * @param url - Normalised origin, or `null` to restore the build default.
 */
export async function saveServerUrl(url: string | null): Promise<void> {
  if (url === null) {
    await Preferences.remove({ key: SERVER_URL_KEY });
  } else {
    await Preferences.set({ key: SERVER_URL_KEY, value: url });
  }
  setApiOrigin(url);
}

/**
 * Server origin currently in effect.
 *
 * @returns Origin without trailing slash.
 */
export function currentServerUrl(): string {
  return API_ORIGIN;
}

/**
 * Build-time default origin.
 *
 * @returns Origin from `VITE_API_BASE_URL` (or the WebView origin when unset).
 */
export function defaultServerUrl(): string {
  return getDefaultApiOrigin();
}

/**
 * Username the device token belongs to (stored at registration).
 *
 * @returns Username or `null` when signed out.
 */
export async function getDeviceUsername(): Promise<string | null> {
  const { value } = await Preferences.get({ key: DEVICE_USERNAME_KEY });
  return value;
}

/**
 * Remember (or forget) the device's username.
 *
 * @param username - Username, or `null` on sign-out.
 */
export async function setDeviceUsername(username: string | null): Promise<void> {
  if (username === null) {
    await Preferences.remove({ key: DEVICE_USERNAME_KEY });
  } else {
    await Preferences.set({ key: DEVICE_USERNAME_KEY, value: username });
  }
}
