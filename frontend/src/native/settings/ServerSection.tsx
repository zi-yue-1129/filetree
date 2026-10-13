/**
 * Server URL override (stored in Capacitor Preferences, applied on reload).
 */
import React, { useState } from 'react';
import { Server } from 'lucide-react';
import { getErrorMessage } from '../index';
import { logoutDevice } from '../deviceAuth';
import { currentServerUrl, defaultServerUrl, normaliseServerUrl, saveServerUrl } from '../serverConfig';
import { ActionButton, Message, SettingsSection, TextField } from './ui';

/** Props of {@link ServerSection}. */
interface ServerSectionProps {
  /** Whether a device token is stored (changing servers signs the device out). */
  deviceSignedIn: boolean;
}

/**
 * Lets the user point the app at another FileNexus server.
 *
 * @param props - Section props.
 * @returns The section.
 */
export const ServerSection: React.FC<ServerSectionProps> = ({ deviceSignedIn }) => {
  const [value, setValue] = useState<string>(currentServerUrl());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async (url: string | null): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const normalised = url === null ? null : normaliseServerUrl(url);
      if (normalised === currentServerUrl()) {
        setBusy(false);
        return;
      }
      if (deviceSignedIn) {
        if (!window.confirm('變更伺服器會登出此裝置並停止背景上傳，確定要繼續嗎？')) {
          setBusy(false);
          return;
        }
        try {
          await logoutDevice();
        } catch (logoutError: unknown) {
          console.error('Device logout before server change failed', logoutError);
          window.alert(getErrorMessage(logoutError));
        }
      }
      await saveServerUrl(normalised);
      // Reload so every module, socket and cached request uses the new origin.
      window.location.reload();
    } catch (caught: unknown) {
      console.error('Saving server URL failed', caught);
      setError(getErrorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <SettingsSection icon={Server} title="伺服器">
      <TextField
        id="native-server-url"
        label="伺服器網址"
        type="url"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="https://files.example.com"
      />
      <p className="text-xs text-gray-500 dark:text-white/40">預設：{defaultServerUrl()}</p>
      {error && <Message tone="error">{error}</Message>}
      <div className="flex flex-wrap gap-2">
        <ActionButton variant="primary" disabled={busy} onClick={() => void apply(value)}>
          儲存並重新載入
        </ActionButton>
        <ActionButton disabled={busy} onClick={() => void apply(null)}>
          恢復預設
        </ActionButton>
      </div>
    </SettingsSection>
  );
};
