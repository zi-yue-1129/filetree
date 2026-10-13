# Native Apps — Progress Log

Newest entries first. Each entry: date, workstream, branch, what is done,
what is next, how to verify. See `docs/NATIVE_APPS.md` for the contract.

## 2026-10-13 — Mobile core + Android (Claude), branch `feat/native-mobile` — milestone 1
- Capacitor 8.5.3 in `frontend/` (`capacitor.config.ts`, `webDir: ../static/dist`
  = Vite `outDir`), `android/` and `ios/` (SPM) platforms generated, icons and
  splash generated from `resources/icon.png` (black background).
- Plugin `frontend/native-plugin/` (`filenexus-native`, JS `FileNexusNative`):
  full TS API in `src/definitions.ts`, web fallback `src/web.ts`, Kotlin and
  Swift skeletons that reject with `unimplemented`. The package points
  `main`/`types` at `src/index.ts` (no separate build step; Vite/tsc compile it).
- API additions beyond contract §5 (needed by the UI; iOS should implement):
  `getConfiguration`, `getNativeInfo`, `pickFiles` (webview `<input type=file>`
  cannot yield native URIs), `clearFinishedUploads`, `clearSharedItems`,
  `runPhotoBackupNow`, `checkPermissions`/`requestPermissions`, events
  `pushReceived`, and Android-only `canInstallPackages`,
  `openInstallPermissionSettings`, `installApkUpdate`, `apkDownloadProgress`
  (iOS: resolve `{allowed:false}` / reject `unavailable`). `configure` also
  takes optional `deviceId`/`deviceName`. Rejections carry `code` from
  `FileNexusErrorCode`.
- `frontend/src/native/index.ts`: `getPlatform()` + typed wrappers.

## 2026-10-13 — Integrator
- Base branch `feat/native-apps` created (Docker + Pages + iOS Shortcut page +
  security fixes #21/#22/#25 merged, QR share-link fix).
- `frontend/resources/icon.png` (1024 px PNG) is the app icon source.
- Workstreams launched: Mobile core + Android (Claude), Desktop (Codex),
  Backend devices/push (Codex). iOS starts once the Capacitor scaffold and
  plugin TS API exist.
