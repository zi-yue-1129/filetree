/** Native desktop notifications attached to the web application's own sockets. */

/** Services supplied by the independently bundled Tauri desktop bridge. */
export interface DesktopNotificationServices {
  /** Show a native notification, requesting OS permission when necessary. */
  notify: () => Promise<void>;
  /** Log failures and surface them through a native error dialog. */
  reportError: (error: unknown) => Promise<void>;
}

/** Observe per-user REFRESH messages without changing the web upload UI.
 *
 * Args:
 *   services: Native notification and error-reporting functions.
 */
export function installDesktopNotifications(services: DesktopNotificationServices): void {
  if (!('__TAURI_INTERNALS__' in window)) return;
  const OriginalWebSocket: typeof WebSocket = window.WebSocket;
  class DesktopWebSocket extends OriginalWebSocket {
    /** Create the application's socket and attach an independent message listener. */
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const socketUrl: URL = new URL(String(url), window.location?.href);
      if (!/^\/api\/ws\/[^/]+$/.test(socketUrl.pathname)) return;
      this.addEventListener('message', (event: MessageEvent): void => {
        if (event.data !== 'REFRESH' ||
            (document.visibilityState === 'visible' && document.hasFocus())) return;
        void services.notify().catch((error: unknown): Promise<void> => services.reportError(error));
      });
    }
  }
  window.WebSocket = DesktopWebSocket;
}
