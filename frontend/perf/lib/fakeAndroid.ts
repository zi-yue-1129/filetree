/**
 * Simulated Capacitor Android bridge for Playwright pages (native code paths
 * without a device). Shared by the functional check and the tap target audit.
 */

/** Options of the simulated Capacitor Android bridge. */
export interface FakeAndroidOptions {
  /** URL returned by `App.getLaunchUrl()` (the App Link that started the app), or null. */
  launchUrl: string | null;
}

/**
 * Install a fake Capacitor Android bridge before any app script runs:
 * `Capacitor.getPlatform()` reports `android`, plugin calls resolve with
 * canned values (unknown ones reject as on a device without the plugin) and
 * `window.__fnFireNativeEvent(plugin, event, data)` emits a plugin event.
 * The clipboard is replaced by a recorder (`window.__fnClipboard`).
 *
 * @param options - Bridge options (serialised into the page).
 */
export function fakeAndroidBridge(options: FakeAndroidOptions): void {
  type Callback = (data: unknown, error?: unknown) => void;
  const listeners = new Map<string, Callback[]>();
  const pluginMethods: Record<string, string[]> = {
    App: ['getLaunchUrl', 'getInfo', 'getState', 'removeListener', 'removeAllListeners'],
    Preferences: ['get', 'set', 'remove', 'keys', 'clear'],
    CapacitorUpdater: ['notifyAppReady', 'list', 'current'],
    FileNexusNative: ['getConfiguration', 'getSharedItems', 'getNativeInfo', 'getUploads', 'removeListener', 'removeAllListeners'],
    Device: ['getInfo', 'getId'],
  };
  const responses: Record<string, unknown> = {
    // Capacitor resolves `{}` when the app was not started by a link.
    'App.getLaunchUrl': options.launchUrl === null ? {} : { url: options.launchUrl },
    'App.getInfo': { version: '0.0.1', build: '1', id: 'cc.spkuan.filenexus', name: 'FileNexus' },
    'Preferences.get': { value: null },
    'CapacitorUpdater.list': { bundles: [] },
    'FileNexusNative.getConfiguration': { serverUrl: null, deviceToken: null, deviceId: null, deviceName: null },
    'FileNexusNative.getSharedItems': { items: [] },
    'FileNexusNative.getUploads': { uploads: [] },
  };
  let nextCallbackId = 0;
  const win = window as unknown as Record<string, unknown>;
  win.androidBridge = { postMessage: (): void => undefined };
  win.Capacitor = {
    PluginHeaders: Object.entries(pluginMethods).map(([name, methods]) => ({
      name,
      methods: [
        ...methods.map((method) => ({ name: method, rtype: 'promise' })),
        { name: 'addListener', rtype: 'callback' },
      ],
    })),
    nativePromise: async (plugin: string, method: string): Promise<unknown> => {
      const key = `${plugin}.${method}`;
      return key in responses ? responses[key] : {};
    },
    nativeCallback: (plugin: string, method: string, callOptions: { eventName?: string }, callback: Callback): string => {
      if (method !== 'addListener' || !callOptions.eventName) {
        throw new Error(`fake bridge: unexpected callback method ${plugin}.${method}`);
      }
      const key = `${plugin}:${callOptions.eventName}`;
      listeners.set(key, [...(listeners.get(key) ?? []), callback]);
      nextCallbackId += 1;
      return String(nextCallbackId);
    },
  };
  win.__fnFireNativeEvent = (plugin: string, eventName: string, data: unknown): number => {
    const callbacks = listeners.get(`${plugin}:${eventName}`) ?? [];
    callbacks.forEach((callback) => callback(data));
    return callbacks.length;
  };
  const clipboardTexts: string[] = [];
  win.__fnClipboard = clipboardTexts;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string): Promise<void> => {
        clipboardTexts.push(text);
      },
      write: async (items: ClipboardItem[]): Promise<void> => {
        for (const item of items) {
          clipboardTexts.push(await (await item.getType('text/plain')).text());
        }
      },
    },
  });
}
