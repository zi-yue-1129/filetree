/**
 * App version info and manual "check for updates" (APK + live web bundle).
 */
import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { FileNexusNative, getErrorMessage, getPlatform } from '../index';
import type { NativeInfo } from 'filenexus-native';
import { checkApkUpdate, installApk } from '../apkUpdate';
import type { AndroidReleaseManifest } from '../apkUpdate';
import { checkWebBundleUpdate } from '../liveUpdate';
import { WEB_BUNDLE_VERSION } from '../version';
import { ActionButton, Message, SettingsSection } from './ui';

/**
 * Version display plus update checks.
 *
 * @returns The section.
 */
export const UpdateSection: React.FC = () => {
  const [info, setInfo] = useState<NativeInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [apk, setApk] = useState<AndroidReleaseManifest | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    FileNexusNative.getNativeInfo()
      .then(setInfo)
      .catch((caught: unknown) => {
        console.error('getNativeInfo failed', caught);
        setError(getErrorMessage(caught));
      });
  }, []);

  const check = async (): Promise<void> => {
    setChecking(true);
    setError(null);
    setMessages([]);
    const found: string[] = [];
    try {
      if (getPlatform() === 'android') {
        const result = await checkApkUpdate();
        if (result.available) {
          setApk(result.latest);
          found.push(`有新版 App：${result.latest.version}`);
        } else {
          found.push(`App 已是最新版本（${result.installedVersion}）`);
        }
      }
      const web = await checkWebBundleUpdate();
      if (web.status === 'scheduled') found.push(`介面更新 ${web.latest} 已下載，下次開啟 App 時套用`);
      else if (web.status === 'needs-native-update') found.push(`介面更新 ${web.latest} 需要 App ${web.minNativeVersion} 以上`);
      else found.push(`介面已是最新版本（${web.current}）`);
      setMessages(found);
    } catch (caught: unknown) {
      console.error('Update check failed', caught);
      setMessages(found);
      setError(`檢查更新失敗：${getErrorMessage(caught)}`);
    } finally {
      setChecking(false);
    }
  };

  const install = async (manifest: AndroidReleaseManifest): Promise<void> => {
    setInstalling(true);
    setError(null);
    try {
      const outcome = await installApk(manifest, setProgress);
      if (outcome === 'permission-required') {
        setMessages(['請在系統設定中允許 FileNexus「安裝未知應用程式」，返回後再按一次安裝']);
      }
    } catch (caught: unknown) {
      console.error('APK install failed', caught);
      setError(getErrorMessage(caught));
    } finally {
      setInstalling(false);
      setProgress(null);
    }
  };

  return (
    <SettingsSection icon={RefreshCw} title="版本與更新">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-white/60">
        <dt>App 版本</dt>
        <dd>{info ? `${info.versionName} (${info.versionCode})` : '—'}</dd>
        <dt>介面版本</dt>
        <dd>{WEB_BUNDLE_VERSION}</dd>
      </dl>
      <ActionButton disabled={checking} onClick={() => void check()}>
        {checking ? '檢查中…' : '檢查更新'}
      </ActionButton>
      {messages.map((message) => (
        <Message key={message} tone="info">{message}</Message>
      ))}
      {apk && (
        <div className="space-y-2">
          {apk.notes && <p className="text-xs whitespace-pre-line text-gray-500 dark:text-white/40">{apk.notes}</p>}
          <ActionButton variant="primary" disabled={installing} onClick={() => void install(apk)}>
            {installing
              ? `下載中… ${progress === null ? '' : `${Math.round(progress * 100)}%`}`
              : `下載並安裝 ${apk.version}`}
          </ActionButton>
        </div>
      )}
      {error && <Message tone="error">{error}</Message>}
    </SettingsSection>
  );
};
