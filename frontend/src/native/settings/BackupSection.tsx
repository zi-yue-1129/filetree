/**
 * Photo/video auto-backup toggles and status.
 */
import React, { useState } from 'react';
import { Images } from 'lucide-react';
import { FileNexusNative, getErrorMessage } from '../index';
import type { PhotoBackupOptions } from '../index';
import { usePhotoBackupStatus } from '../hooks';
import { formatTime } from './format';
import { ActionButton, Message, SettingsSection, Toggle } from './ui';

/** Props of {@link BackupSection}. */
interface BackupSectionProps {
  /** Backup needs a signed-in device. */
  deviceSignedIn: boolean;
}

/** zh-TW labels for the permission states. */
const PERMISSION_LABEL: Record<string, string> = {
  granted: '已允許',
  limited: '部分存取（僅備份您選取的相片）',
  denied: '已拒絕（請到系統設定開啟）',
  prompt: '尚未詢問',
  'prompt-with-rationale': '尚未允許',
};

/**
 * Configure automatic backup into `相簿備份/<device>`.
 *
 * @param props - Section props.
 * @returns The section.
 */
export const BackupSection: React.FC<BackupSectionProps> = ({ deviceSignedIn }) => {
  const { data: status, error: loadError, setData, refresh } = usePhotoBackupStatus();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = async (changes: Partial<PhotoBackupOptions>): Promise<void> => {
    if (!status) return;
    setBusy(true);
    setError(null);
    try {
      const next = await FileNexusNative.setPhotoBackup({
        enabled: changes.enabled ?? status.enabled,
        wifiOnly: changes.wifiOnly ?? status.wifiOnly,
        includeVideos: changes.includeVideos ?? status.includeVideos,
      });
      setData(next);
      if (changes.enabled && !next.enabled) {
        setError('需要相簿權限才能啟用備份');
      }
    } catch (caught: unknown) {
      console.error('Updating photo backup failed', caught);
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const runNow = async (): Promise<void> => {
    setError(null);
    try {
      await FileNexusNative.runPhotoBackupNow();
      window.setTimeout(() => void refresh(), 3000);
    } catch (caught: unknown) {
      console.error('Manual photo backup failed', caught);
      setError(getErrorMessage(caught));
    }
  };

  return (
    <SettingsSection icon={Images} title="相簿備份">
      {!deviceSignedIn && <Message tone="info">請先登入此裝置才能啟用相簿備份。</Message>}
      {loadError && <Message tone="error">{loadError}</Message>}
      {status && (
        <>
          <Toggle
            label="自動備份新的相片"
            checked={status.enabled}
            disabled={busy || !deviceSignedIn}
            onChange={(enabled) => void update({ enabled })}
          />
          <Toggle
            label="包含影片"
            checked={status.includeVideos}
            disabled={busy}
            onChange={(includeVideos) => void update({ includeVideos })}
          />
          <Toggle
            label="僅在 Wi-Fi 下上傳"
            checked={status.wifiOnly}
            disabled={busy}
            onChange={(wifiOnly) => void update({ wifiOnly })}
          />
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-white/60">
            <dt>權限</dt>
            <dd>{PERMISSION_LABEL[status.permission] ?? status.permission}</dd>
            <dt>上次檢查</dt>
            <dd>{formatTime(status.lastRunAt)}</dd>
            <dt>最新備份項目</dt>
            <dd>{formatTime(status.lastBackedUpAt)}</dd>
            <dt>已排入上傳</dt>
            <dd>{status.enqueuedCount} 個</dd>
          </dl>
          <p className="text-xs text-gray-500 dark:text-white/40">只會備份啟用後新增的相片與影片，存放於「相簿備份/裝置名稱」資料夾。</p>
          {status.lastError && <Message tone="info">{status.lastError}</Message>}
          {status.enabled && (
            <ActionButton disabled={busy} onClick={() => void runNow()}>
              立即檢查
            </ActionButton>
          )}
        </>
      )}
      {error && <Message tone="error">{error}</Message>}
    </SettingsSection>
  );
};
