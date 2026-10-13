# FileNexus Native Apps — Shared Contract

Single source of truth for every agent (Claude or Codex) working on the native
apps. If you change anything in this contract, update this file in the same
commit. Append progress to `docs/NATIVE_APPS_PROGRESS.md` (newest first) before
you stop, so another agent can resume.

Audience: a small group of friends; **no app stores**. Distribution is via
installers on GitHub Releases plus in-app self-update.

## 1. Identity & versioning

| Item | Value |
| --- | --- |
| App name | `FileNexus` |
| Bundle / application id | `cc.spkuan.filenexus` (iOS share extension: `cc.spkuan.filenexus.share`) |
| Repo | `zi-yue-1129/filetree` (public) |
| Version source | git tag `vX.Y.Z` → `X.Y.Z` |
| Android `versionCode` | `X*10000 + Y*100 + Z` |
| Server URL | build-time `VITE_API_BASE_URL` (see `frontend/src/services/api.ts`); native apps may override it at runtime via a settings screen (stored in Capacitor Preferences / Tauri store) |

## 2. Layout & file ownership

Each workstream only edits files it owns. Touching another owner's file
requires a note in the progress log explaining why.

| Workstream | Owns |
| --- | --- |
| **Mobile core + Android** | `frontend/capacitor.config.ts`, `frontend/android/**`, `frontend/native-plugin/` (TS API, `android/**`), `frontend/src/native/**` (except `desktop/`), `frontend/package.json` deps for Capacitor, `.github/workflows/build-android.yml`, `.github/workflows/build-web-bundle.yml` |
| **iOS** | `frontend/ios/**`, `frontend/native-plugin/ios/**`, `.github/workflows/build-ios.yml`, `docs/IOS_SIDELOAD.md` |
| **Desktop** | `desktop/**` (Tauri v2 project), `frontend/src/native/desktop/**`, `.github/workflows/build-desktop.yml` |
| **Backend** | `backend/**` (incl. `backend/tests/**`), `docker-compose.yml` env additions |
| **Integrator (main session)** | `.github/workflows/release.yml`, this file, merges |

Capacitor lives inside `frontend/` (shares `package.json` with the web app).
The custom native plugin is a local package `frontend/native-plugin/`
(`"filenexus-native": "file:./native-plugin"`), JS name `FileNexusNative`.

## 3. Backend API additions (Backend workstream implements; clients consume)

Existing tokens are in-memory and expire (session 72h); native background work
needs a **device token**: long-lived, persisted (hashed) in `users.db`,
revocable, owner-scoped (same rights as a session token).

| Method & path | Auth | Body / result |
| --- | --- | --- |
| `POST /api/devices/register` | form/JSON `password` | `{device_name, platform: android\|ios\|windows\|macos, push_token?}` → `{device_id, device_token, username}` |
| `PATCH /api/devices/{device_id}` | `Authorization: Bearer <device_token>` | `{device_name?, push_token?}` → `{ok: true}` |
| `DELETE /api/devices/{device_id}` | device token of that device, or owner session token | revoke → `{ok: true}` |
| `GET /api/devices` | owner session or device token | list own devices (no secrets) |
| `POST /api/backup/folder` | device token | `{device_name}` → `{folder_id}`; creates/returns file folder `相簿備份/<device_name>` |

- A device token is accepted everywhere an owner session token is accepted:
  `Authorization: Bearer`, form/query `token`, and TUS `Upload-Metadata` `token`
  (via `token_service.is_owner_token` / `owner_username`).
- TUS `Upload-Metadata` keys clients send: `filename`, `filetype`, `token`,
  optional `folder_id`, optional `relativePath`, optional `lastModified`.
- Push: Firebase Cloud Messaging HTTP v1 for Android devices that registered a
  `push_token`. Enabled when env `PUSH__FCM_SERVICE_ACCOUNT_FILE` points to a
  service-account JSON; otherwise disabled with one startup warning. Events:
  `files_added` (files uploaded to the account from another device or the web;
  debounced ~30 s per user; excludes the uploading device),
  `upload_failed` is client-local only. Payload data keys:
  `{type, username, count}`; notification title/body in zh-TW.
- iOS/desktop have no remote push: they show local notifications from the
  existing per-user WebSocket (`/api/ws/{username}?token=`) while running.

## 4. Update channels (GitHub Release assets)

Clients fetch from
`https://github.com/zi-yue-1129/filetree/releases/latest/download/<asset>`.

| Asset | Producer | Consumer |
| --- | --- | --- |
| `web-bundle.json` `{version, url, sha256, minNativeVersion}` + `web-bundle-<ver>.zip` (built frontend, `index.html` at zip root, built with production `VITE_API_BASE_URL`) | build-web-bundle | Android + iOS live update (Capgo `@capgo/capacitor-updater`, manual/self-hosted mode). Apply only if `nativeVersion >= minNativeVersion`; download in background, apply on next app start; roll back if the new bundle does not call `notifyAppReady()` within 10 s |
| `android.json` `{version, versionCode, url, sha256, notes}` + `FileNexus-<ver>.apk` | build-android | Android in-app updater: download APK, verify sha256, launch system installer (`REQUEST_INSTALL_PACKAGES`) |
| `FileNexus-<ver>-unsigned.ipa` + `sidestore-source.json` (AltStore/SideStore source format) | build-ios | SideStore (users re-sign with their free Apple ID) |
| `latest.json` + Tauri bundles (`.msi`/`-setup.exe`, `.dmg`, `.app.tar.gz`) + `.sig` | build-desktop | Tauri updater plugin |

Signing secrets (GitHub Actions secrets; never commit keys):
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`, `TAURI_SIGNING_PRIVATE_KEY`,
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Production API URL comes from repo
variable `VITE_API_BASE_URL`.

Workflows: each `build-*.yml` is a reusable workflow (`on: workflow_call` with
input `version`, plus `workflow_dispatch` for manual test builds that upload
artifacts only). `release.yml` (integrator) runs on tag `v*`: creates the
release once, then calls every `build-*.yml`, which upload assets with
`gh release upload <tag> ... --clobber`. Pin every third-party action to a
full version tag.

## 5. Native features (mobile)

`FileNexusNative` plugin API (TypeScript, implemented on Android and iOS):

- `configure({serverUrl, deviceToken})` — persist credentials natively so
  background work survives app kill.
- `enqueueUpload({files: [{uri, name, mimeType}], folderId?})` → `{jobIds}` —
  native TUS upload (Android: WorkManager + foreground notification +
  tus-java-client; iOS: background `URLSession`), resumable, retries with
  backoff, local notification on finish/failure.
- `getUploads()` / `cancelUpload({jobId})` and event `uploadProgress`
  `{jobId, bytesSent, bytesTotal, state}`.
- `getSharedItems()` / event `sharedItems` — files received from the OS share
  sheet (Android `ACTION_SEND`/`SEND_MULTIPLE`; iOS Share Extension writes to
  the app's shared container). If a device token is configured, shared items
  are uploaded immediately without opening the UI.
- `setPhotoBackup({enabled, wifiOnly, includeVideos})` /
  `getPhotoBackupStatus()` — upload new photos/videos to the device's
  `相簿備份/<device>` folder (Android: MediaStore observer + periodic
  WorkManager; iOS: PhotoKit change tracking + BGProcessingTask, best effort).
- `registerPush()` → `{token}` (Android FCM; iOS returns local-only).

Web UI integration (`frontend/src/native/`): `getPlatform()` returning
`'web' | 'android' | 'ios' | 'desktop'`; a native-only Settings page (server
URL, device login/logout, photo backup toggles, upload queue, app version and
"check for updates"); when native, uploads from the Landing page go through
`enqueueUpload` instead of Uppy/TUS-in-webview.
