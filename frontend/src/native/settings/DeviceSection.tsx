/**
 * Device login (password → device token) and logout (revoke).
 */
import React, { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import type { NativeConfiguration } from '../index';
import { getErrorMessage } from '../index';
import { enablePush, logoutDevice, registerDevice, suggestDeviceName } from '../deviceAuth';
import { getDeviceUsername } from '../serverConfig';
import { ActionButton, Message, SettingsSection, TextField } from './ui';

/** Props of {@link DeviceSection}. */
interface DeviceSectionProps {
  /** Native configuration (`null` while loading). */
  config: NativeConfiguration | null;
  /** Called after login/logout so the page reloads native state. */
  onChanged: () => Promise<void>;
}

/**
 * Sign this device in for background uploads, backup and push.
 *
 * @param props - Section props.
 * @returns The section.
 */
export const DeviceSection: React.FC<DeviceSectionProps> = ({ config, onChanged }) => {
  const [password, setPassword] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [username, setUsername] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const signedIn = Boolean(config?.deviceToken);

  useEffect(() => {
    let active = true;
    Promise.all([suggestDeviceName(), getDeviceUsername()])
      .then(([suggested, stored]) => {
        if (!active) return;
        setDeviceName((current) => current || suggested);
        setUsername(stored);
      })
      .catch((caught: unknown) => {
        console.error('Loading device info failed', caught);
        if (active) setError(getErrorMessage(caught));
      });
    return () => {
      active = false;
    };
  }, [signedIn]);

  const login = async (): Promise<void> => {
    if (!password || !deviceName.trim()) {
      setError('請輸入密碼與裝置名稱');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await registerDevice(password, deviceName.trim());
      setPassword('');
      setUsername(result.username);
      setNotice(result.push === 'enabled' ? `已登入 ${result.username}，推播已啟用` : `已登入 ${result.username}（${result.push}）`);
      await onChanged();
    } catch (caught: unknown) {
      console.error('Device login failed', caught);
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const logout = async (): Promise<void> => {
    if (!window.confirm('登出後將停止背景上傳與相簿備份，確定要登出此裝置嗎？')) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await logoutDevice();
      setNotice('已登出此裝置');
    } catch (caught: unknown) {
      console.error('Device logout failed', caught);
      setError(`${getErrorMessage(caught)}（本機已登出）`);
    } finally {
      setUsername(null);
      setBusy(false);
      await onChanged();
    }
  };

  const retryPush = async (): Promise<void> => {
    const status = await enablePush();
    setNotice(status === 'enabled' ? '推播已啟用' : status);
  };

  return (
    <SettingsSection icon={KeyRound} title="裝置登入">
      {signedIn ? (
        <>
          <Message tone="info">
            此裝置已登入 {username ?? '(未知帳號)'}，名稱「{config?.deviceName ?? '—'}」。
          </Message>
          <div className="flex flex-wrap gap-2">
            <ActionButton disabled={busy} onClick={() => void retryPush()}>
              重新註冊推播
            </ActionButton>
            <ActionButton variant="danger" disabled={busy} onClick={() => void logout()}>
              登出此裝置
            </ActionButton>
          </div>
        </>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void login();
          }}
        >
          <p className="text-sm text-gray-500 dark:text-white/50">
            登入後，分享的檔案、相簿備份與背景上傳會直接存入您的帳號。
          </p>
          <TextField
            id="native-device-name"
            label="裝置名稱"
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
          />
          <TextField
            id="native-device-password"
            label="帳號密碼"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <ActionButton type="submit" variant="primary" disabled={busy}>
            {busy ? '登入中…' : '登入此裝置'}
          </ActionButton>
        </form>
      )}
      {notice && <Message tone="success">{notice}</Message>}
      {error && <Message tone="error">{error}</Message>}
    </SettingsSection>
  );
};
