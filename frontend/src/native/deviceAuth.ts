/**
 * Device login/logout against the device-token API (contract §3) and hand-off
 * of the credentials to native code via `FileNexusNative.configure`.
 */
import { Device } from '@capacitor/device';
import { apiUrl } from '../services/api';
import { FileNexusNative, getErrorMessage, getNativeErrorCode, getPlatform } from './index';
import { currentServerUrl, setDeviceUsername } from './serverConfig';

/** Response of `POST /api/devices/register`. */
interface RegisterDeviceResponse {
  device_id: string;
  device_token: string;
  username: string;
}

/** Outcome of {@link registerDevice}. */
export interface DeviceLoginResult {
  /** Account the device is now signed in to. */
  username: string;
  /** Device name sent to the server. */
  deviceName: string;
  /** Push status: `enabled`, or a zh-TW explanation why it is not. */
  push: 'enabled' | string;
}

/**
 * Suggest a device name from the hardware model.
 *
 * @returns e.g. `Google Pixel 8`.
 */
export async function suggestDeviceName(): Promise<string> {
  const info = await Device.getInfo();
  const name = info.name?.trim();
  if (name) return name;
  return `${info.manufacturer} ${info.model}`.trim();
}

/**
 * Parse an error body from the API.
 *
 * @param response - Failed response.
 * @returns The `detail` message or the status text.
 */
async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
  } catch (error: unknown) {
    console.error('Device API returned a non-JSON error body', error, text);
  }
  return `${response.status} ${response.statusText}`;
}

/**
 * Register this device with the user's password and store the device token natively.
 *
 * @param password - Account password.
 * @param deviceName - Name shown in the device list and used for the backup folder.
 * @returns Login result including push registration status.
 * @throws Error when the server rejects the password or is unreachable.
 */
export async function registerDevice(password: string, deviceName: string): Promise<DeviceLoginResult> {
  const platform = getPlatform();
  if (platform !== 'android' && platform !== 'ios') {
    throw new Error('裝置登入僅適用於手機 App');
  }
  const response = await fetch(apiUrl('/api/devices/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, device_name: deviceName, platform }),
  });
  if (!response.ok) {
    throw new Error(`登入失敗：${await readError(response)}`);
  }
  const body = (await response.json()) as RegisterDeviceResponse;
  await FileNexusNative.configure({
    serverUrl: currentServerUrl(),
    deviceToken: body.device_token,
    deviceId: body.device_id,
    deviceName,
  });
  await setDeviceUsername(body.username);
  return { username: body.username, deviceName, push: await enablePush() };
}

/**
 * Ask for notification permission and register for push (Android FCM).
 *
 * @returns `enabled` or a zh-TW reason push is unavailable.
 */
export async function enablePush(): Promise<string> {
  try {
    const permissions = await FileNexusNative.requestPermissions({ permissions: ['notifications'] });
    if (permissions.notifications !== 'granted') {
      return '未允許通知權限';
    }
    await FileNexusNative.registerPush();
    return 'enabled';
  } catch (error: unknown) {
    if (getNativeErrorCode(error) === 'PUSH_NOT_CONFIGURED') {
      return '此版本未設定推播（缺少 Firebase 設定）';
    }
    console.error('Push registration failed', error);
    return `推播註冊失敗：${getErrorMessage(error)}`;
  }
}

/**
 * Revoke the device token on the server and clear it natively.
 *
 * Local credentials are cleared even when the server call fails (e.g. the
 * server is unreachable); the error is rethrown so the UI can tell the user
 * the token may still be listed on the server.
 */
export async function logoutDevice(): Promise<void> {
  const config = await FileNexusNative.getConfiguration();
  let revokeError: Error | null = null;
  if (config.deviceId && config.deviceToken) {
    try {
      const response = await fetch(apiUrl(`/api/devices/${encodeURIComponent(config.deviceId)}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${config.deviceToken}` },
      });
      if (!response.ok && response.status !== 401 && response.status !== 404) {
        revokeError = new Error(`伺服器撤銷裝置失敗：${await readError(response)}`);
      }
    } catch (error: unknown) {
      revokeError = new Error(`無法連線伺服器撤銷裝置：${getErrorMessage(error)}`, { cause: error });
    }
  }
  await FileNexusNative.configure({ serverUrl: currentServerUrl(), deviceToken: null, deviceId: null, deviceName: null });
  await setDeviceUsername(null);
  if (revokeError) throw revokeError;
}
