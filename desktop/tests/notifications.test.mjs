/** Exercise the bridge against browser-like sockets without requiring a webview. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { build } from 'esbuild';

test('only hidden/unfocused per-user REFRESH events notify, without replacing app handlers', async () => {
  const { outputFiles } = await build({
    entryPoints: ['../frontend/src/native/desktop/notifications.ts'],
    bundle: true, format: 'esm', write: false,
  });
  const bridge = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
  class Socket extends EventTarget {
    constructor(url) { super(); this.url = String(url); }
  }
  let focused = true;
  let notifications = 0;
  globalThis.window = { __TAURI_INTERNALS__: {}, WebSocket: Socket };
  globalThis.document = { hasFocus: () => focused, visibilityState: 'visible' };
  bridge.installDesktopNotifications({ notify: async () => { notifications += 1; }, reportError: async (error) => { throw error; } });
  const user = new window.WebSocket('wss://api.example.org/api/ws/alice?token=secret');
  let applicationEvents = 0;
  user.addEventListener('message', () => { applicationEvents += 1; });
  user.dispatchEvent(new MessageEvent('message', { data: 'REFRESH' }));
  assert.equal(notifications, 0);
  focused = false;
  user.dispatchEvent(new MessageEvent('message', { data: 'REFRESH' }));
  assert.equal(notifications, 1);
  const global = new window.WebSocket('wss://api.example.org/ws/global');
  global.dispatchEvent(new MessageEvent('message', { data: 'REFRESH' }));
  user.dispatchEvent(new MessageEvent('message', { data: 'OTHER' }));
  assert.equal(notifications, 1);
  document.visibilityState = 'hidden';
  focused = true;
  user.dispatchEvent(new MessageEvent('message', { data: 'REFRESH' }));
  assert.equal(notifications, 2);
  assert.equal(applicationEvents, 4);
});
