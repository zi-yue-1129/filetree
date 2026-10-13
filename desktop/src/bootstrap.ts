/** Inject native services before the shared React application evaluates. */
import { installDesktopNotifications } from '../../frontend/src/native/desktop/notifications';
import { clearDesktopAuthentication } from '../../frontend/src/native/desktop/settings';

/** Report desktop errors to Rust and to a native dialog, including reporting failures. */
async function reportError(error: unknown): Promise<void> {
  const detail: string = error instanceof Error ? error.message : String(error);
  console.error(`FileNexus desktop operation failed: ${detail}`);
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('log_desktop_error', { detail });
    const { message } = await import('@tauri-apps/plugin-dialog');
    await message(detail, { title: 'FileNexus 錯誤', kind: 'error' });
  } catch (reportingError: unknown) {
    console.error('Failed to show native desktop error dialog:', reportingError);
  }
}

let checkingUpdate: boolean = false;

/** Check signed update metadata, ask permission with release notes, then install. */
async function checkForUpdates(manual: boolean): Promise<void> {
  if (checkingUpdate) return;
  checkingUpdate = true;
  let update: Awaited<ReturnType<typeof import('@tauri-apps/plugin-updater').check>> = null;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const { ask, message } = await import('@tauri-apps/plugin-dialog');
    update = await check({ timeout: 30_000 });
    if (!update) {
      if (manual) await message('目前已是最新版本。', { title: 'FileNexus 更新' });
      return;
    }
    const accepted: boolean = await ask(
      `新版本 ${update.version}\n\n${update.body ?? '此版本未提供更新說明。'}\n\n下載、安裝並重新啟動？`,
      { title: 'FileNexus 更新', kind: 'info', okLabel: '更新', cancelLabel: '稍後' },
    );
    if (!accepted) return;
    console.info(`Downloading FileNexus update ${update.version}`);
    await update.downloadAndInstall();
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (error: unknown) {
    await reportError(error);
  } finally {
    if (update) {
      try { await update.close(); }
      catch (error: unknown) { await reportError(error); }
    }
    checkingUpdate = false;
  }
}

/** Open a minimal native-only editor for the persisted backend origin. */
async function openSettings(): Promise<void> {
  if (document.getElementById('filenexus-desktop-settings')) return;
  const { load } = await import('@tauri-apps/plugin-store');
  const store = await load('settings.json', { autoSave: false, defaults: {} });
  const override: string | undefined = await store.get<string>('serverUrl');
  const panel: HTMLDialogElement = document.createElement('dialog');
  panel.id = 'filenexus-desktop-settings';
  panel.style.cssText = 'margin:auto;padding:24px;border-radius:12px;max-width:90vw;color:#111;background:white;z-index:10000';
  panel.innerHTML = '<form><h2>FileNexus 桌面設定</h2><p>伺服器網址（留空使用建置預設值）</p><label>API 網址 <input type="url" aria-label="API 網址" placeholder="https://api.example.com" style="width:320px;max-width:70vw;border:1px solid #777;padding:8px" /></label><p>儲存後會重新啟動，需重新登入。</p><button type="submit">儲存並重新啟動</button> <button type="button">取消</button></form>';
  const input: HTMLInputElement | null = panel.querySelector('input');
  const form: HTMLFormElement | null = panel.querySelector('form');
  const cancel: HTMLButtonElement | null = panel.querySelector('button[type=button]');
  if (!input || !form || !cancel) throw new Error('Desktop settings form could not be initialized');
  input.value = override ?? '';
  cancel.addEventListener('click', (): void => panel.close());
  panel.addEventListener('close', (): void => panel.remove());
  form.addEventListener('submit', (event: SubmitEvent): void => {
    event.preventDefault();
    void (async (): Promise<void> => {
      const origin: string = input.value.trim().replace(/\/+$/, '');
      if (origin) {
        const url: URL = new URL(origin);
        if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
          throw new Error('Server URL must be an HTTP(S) origin without a path, credentials, or query');
        }
      }
      // Clear authentication before persisting the new origin so no subsequent
      // launch can transmit the previous server's credentials to another host.
      clearDesktopAuthentication(localStorage, sessionStorage);
      if (origin) {
        await store.set('serverUrl', origin);
      } else {
        await store.delete('serverUrl');
      }
      await store.save();
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    })().catch(reportError);
  });
  document.body.append(panel);
  panel.showModal();
}

/** Register desktop-only event handlers and periodic native update checks. */
async function initializeDesktop(): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) return;
  installDesktopNotifications({
    notify: async (): Promise<void> => {
      const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
      let permitted: boolean = await isPermissionGranted();
      if (!permitted) permitted = (await requestPermission()) === 'granted';
      if (!permitted) throw new Error('Desktop notification permission was denied; enable it in OS settings.');
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('notify_refresh');
    },
    reportError,
  });
  const { listen } = await import('@tauri-apps/api/event');
  await listen('desktop-check-updates', (): void => { void checkForUpdates(true); });
  await listen('desktop-settings', (): void => { void openSettings().catch(reportError); });
  window.setInterval((): void => { void checkForUpdates(false); }, 6 * 60 * 60 * 1000);
  void checkForUpdates(false);
}

void initializeDesktop().catch(reportError);
