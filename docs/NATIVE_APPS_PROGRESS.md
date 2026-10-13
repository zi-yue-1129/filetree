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

## 2026-10-13 — Integrator (deployment note)
- The production backend will NOT run on the development machine; it will be
  deployed on another host with `docker compose --profile tunnel up -d`
  (see `docs/DEPLOYMENT.md`). Do not assume `localhost` or this machine's
  cloudflared config anywhere. The final API hostname is not decided yet;
  repo variable `VITE_API_BASE_URL` holds a placeholder
  (`https://api-filetree.spkuan.cc`) and apps must keep the runtime
  server-URL override.
- Release signing keys exist only in `~/.config/filenexus-release/` on the
  development machine and in GitHub secrets.

## 2026-10-13 — Integrator
- Base branch `feat/native-apps` created (Docker + Pages + iOS Shortcut page +
  security fixes #21/#22/#25 merged, QR share-link fix).
- `frontend/resources/icon.png` (1024 px PNG) is the app icon source.
- Workstreams launched: Mobile core + Android (Claude), Desktop (Codex),
  Backend devices/push (Codex). iOS starts once the Capacitor scaffold and
  plugin TS API exist.
