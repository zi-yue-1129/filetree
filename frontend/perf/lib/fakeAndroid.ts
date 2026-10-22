/**
 * Simulated Capacitor Android bridge for Playwright pages (native code paths
 * without a device). Shared by the functional check and the tap target audit.
 */

/** Options of the simulated Capacitor Android bridge. */
export interface FakeAndroidOptions {
  /** URL returned by `App.getLaunchUrl()` (the App Link that started the app), or null. */
  launchUrl: string | null;
  /**
   * Extra or replaced canned plugin responses keyed `Plugin.method`
   * (e.g. a signed-in `FileNexusNative.getConfiguration`).
   */
  responses?: Record<string, unknown>;
}

/**
 * Install a fake Capacitor Android bridge before any app script runs:
 * `Capacitor.getPlatform()` reports `android`, plugin calls resolve with
 * canned values (unknown ones reject as on a device without the plugin) and
 * `window.__fnFireNativeEvent(plugin, event, data)` emits a plugin event.
 * `window.__fnNativeResponses` holds the canned responses (tests may replace
 * entries at runtime), `window.__fnNativeCalls` records every promise call
 * and `window.__fnNativeListenerCount(plugin, event)` counts live listeners.
 * The clipboard is replaced by a recorder (`window.__fnClipboard`).
 *
 * @param options - Bridge options (serialised into the page).
 */
export function fakeAndroidBridge(options: FakeAndroidOptions): void {
  type Callback = (data: unknown, error?: unknown) => void;
  const listeners = new Map<string, Array<{ id: string; callback: Callback }>>();
  const pluginMethods: Record<string, string[]> = {
    App: ['getLaunchUrl', 'getInfo', 'getState', 'removeListener', 'removeAllListeners'],
    Preferences: ['get', 'set', 'remove', 'keys', 'clear'],
    CapacitorUpdater: ['notifyAppReady', 'list', 'current'],
    FileNexusNative: [
      'getConfiguration', 'getSharedItems', 'getNativeInfo', 'getUploads', 'pickFiles', 'enqueueUpload',
      'cancelUpload', 'clearFinishedUploads', 'removeListener', 'removeAllListeners',
    ],
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
    ...options.responses,
  };
  const calls: Array<{ key: string; options: unknown }> = [];
  let nextCallbackId = 0;
  const win = window as unknown as Record<string, unknown>;
  win.__fnNativeResponses = responses;
  win.__fnNativeCalls = calls;
  win.androidBridge = { postMessage: (): void => undefined };
  win.Capacitor = {
    PluginHeaders: Object.entries(pluginMethods).map(([name, methods]) => ({
      name,
      methods: [
        ...methods.map((method) => ({ name: method, rtype: 'promise' })),
        { name: 'addListener', rtype: 'callback' },
      ],
    })),
    nativePromise: async (plugin: string, method: string, callOptions?: unknown): Promise<unknown> => {
      const key = `${plugin}.${method}`;
      calls.push({ key, options: callOptions });
      if (method === 'removeListener') {
        const { eventName, callbackId } = (callOptions ?? {}) as { eventName?: string; callbackId?: string };
        const listenerKey = `${plugin}:${eventName ?? ''}`;
        listeners.set(listenerKey, (listeners.get(listenerKey) ?? []).filter((entry) => entry.id !== callbackId));
      }
      return key in responses ? responses[key] : {};
    },
    nativeCallback: (plugin: string, method: string, callOptions: { eventName?: string }, callback: Callback): string => {
      if (method !== 'addListener' || !callOptions.eventName) {
        throw new Error(`fake bridge: unexpected callback method ${plugin}.${method}`);
      }
      const key = `${plugin}:${callOptions.eventName}`;
      nextCallbackId += 1;
      const id = String(nextCallbackId);
      listeners.set(key, [...(listeners.get(key) ?? []), { id, callback }]);
      return id;
    },
  };
  win.__fnFireNativeEvent = (plugin: string, eventName: string, data: unknown): number => {
    const callbacks = listeners.get(`${plugin}:${eventName}`) ?? [];
    callbacks.forEach((entry) => entry.callback(data));
    return callbacks.length;
  };
  win.__fnNativeListenerCount = (plugin: string, eventName: string): number =>
    (listeners.get(`${plugin}:${eventName}`) ?? []).length;
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
