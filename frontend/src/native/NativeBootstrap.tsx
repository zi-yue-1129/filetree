/**
 * Invisible component mounted once inside the router on mobile builds:
 * startup update checks and routing of share-sheet items to Settings.
 */
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileNexusNative, getErrorMessage, getPlatform, isMobileNative } from './index';
import { checkApkUpdate, installApk } from './apkUpdate';
import { checkWebBundleUpdate } from './liveUpdate';

/**
 * Prompt for an APK update when one is published (Android only).
 * Startup checks are best-effort: failures (offline, no release yet) are
 * logged and the user can retry from Settings, where errors are shown.
 */
async function promptForApkUpdate(): Promise<void> {
  if (getPlatform() !== 'android') return;
  const result = await checkApkUpdate();
  if (!result.available) return;
  const notes = result.latest.notes ? `\n\n${result.latest.notes}` : '';
  if (!window.confirm(`FileNexus ${result.latest.version} 已推出（目前 ${result.installedVersion}），要立即下載更新嗎？${notes}`)) {
    return;
  }
  const outcome = await installApk(result.latest, () => undefined);
  if (outcome === 'permission-required') {
    window.alert('請允許 FileNexus「安裝未知應用程式」，然後到「設定 → 檢查更新」再安裝一次。');
  }
}

/**
 * Runs native startup tasks; renders nothing.
 *
 * @returns `null`.
 */
export const NativeBootstrap: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isMobileNative()) return undefined;
    let cancelled = false;

    const openSettingsIfShared = async (): Promise<void> => {
      const [{ items }, config] = await Promise.all([FileNexusNative.getSharedItems(), FileNexusNative.getConfiguration()]);
      if (!cancelled && items.length > 0 && !config.deviceToken) navigate('/settings');
    };
    openSettingsIfShared().catch((error: unknown) => console.error('Reading shared items failed', error));

    const listener = FileNexusNative.addListener('sharedItems', (event) => {
      if (event.items.length > 0) navigate('/settings');
    });

    promptForApkUpdate()
      .catch((error: unknown) => console.error(`Startup APK update check failed: ${getErrorMessage(error)}`, error))
      .then(() => checkWebBundleUpdate())
      .then((result) => {
        if (result) console.info('Live update check', result);
      })
      .catch((error: unknown) => console.error(`Startup live update check failed: ${getErrorMessage(error)}`, error));

    return () => {
      cancelled = true;
      listener
        .then((handle) => handle.remove())
        .catch((error: unknown) => console.error('Removing sharedItems listener failed', error));
    };
  }, [navigate]);

  return null;
};
