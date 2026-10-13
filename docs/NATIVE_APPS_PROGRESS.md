# Native Apps — Progress Log

Newest entries first. Each entry: date, workstream, branch, what is done,
what is next, how to verify. See `docs/NATIVE_APPS.md` for the contract.

## 2026-10-13 — iOS (Codex), branch `feat/native-ios` — implementation / CI pending

- Done: app-local Keychain configuration; durable file-backed TUS queue with
  create/HEAD/PATCH, original/chunk files, proxy Location rewriting, strict
  offsets, 10-attempt exponential retries, local completion/failure notifications,
  cancellation/termination, queue events and all shared TypeScript API methods.
- Done: original-resource PhotoKit backup, creation-date + localIdentifier enqueue
  and completion checkpoints, per-resource deduplication, background processing /
  refresh registration at launch, foreground + PhotoKit change scans, limited access.
  Backups begin with newly created assets after enabling; batches are 50 assets.
- Done: `cc.spkuan.filenexus.share` target embedded under PlugIns; files/images/
  videos/URLs (URLs become text files). Optional App Group credentials/inbox and
  background session with sharedContainerIdentifier. Default SideStore unsigned
  IPA requires no App Group entitlement: independent extension device login,
  extension-local Keychain and visible in-process upload before dismissing.
  SideStore signing code appends Team ID to groups; installed profile discovery
  handles that when a signer supplies group entitlements. Shared Keychain and
  cross-sandbox URL path handoff are intentionally avoided. Source evidence and
  friend-facing LocalDevVPN/iLoader/pairing instructions are in IOS_SIDELOAD.md.
- Done: existing generated 1024px app icon retained; SPM links Capgo and native
  plugin, CI checks manual update mode / 10-second rollback configuration.
  Reusable unsigned IPA build, push/dispatch test artifacts, v2 SideStore source,
  identity/version/arm64/unsigned checks, upload to existing draft release only.
- Verification: Linux cannot run Xcode. CI compilation/protocol checks and IPA
  inspection are pending the first branch push; no device result is claimed.
- Needs real iPhone: free-account SideStore install (Keep Extensions), independent
  share login/upload, Files/Photos/Safari providers, large media/lifetime limits,
  suspension/relaunch/network interruption/revocation, notifications, limited Photos,
  BG scheduling, optional rewritten App Group, Capgo bundle swap and rollback.
- Limits: iOS controls background opportunities; force-quit cancels transfers.
  No APNs. Wi-Fi-only backup requires locally available originals; iCloud-only
  resources surface export errors rather than silently using cellular. Extension
  foreground transfers require keeping the share UI open; main-app logout does
  not revoke the independently registered share device.
- Ownership: only iOS-owned files and this required shared progress entry changed;
  definitions.ts and capacitor.config.ts are unchanged.

## 2026-10-13 — Mobile core + Android (Claude), branch `feat/native-mobile` — Android implementation
Done
- Android plugin (`frontend/native-plugin/android`, Kotlin): hand-rolled TUS
  client on OkHttp (not tus-java-client: OkHttp is already shipped by Capgo,
  we must rewrite the backend's `Location` (built from `request.base_url`,
  e.g. `http://backend:5168/...` behind proxies) onto the configured origin,
  and resume state lives in our own SQLite job store); two WorkManager queue
  runners (any network / unmetered) as a `dataSync` foreground service with
  progress notification, exponential backoff (30 s base, 10 attempts),
  resume via persisted upload URL + HEAD, completion/failure notifications,
  `uploadProgress` events. Share target = translucent
  `ShareReceiverActivity` (SEND/SEND_MULTIPLE `*/*`, text shares become a
  `.txt`): copies into `filesDir/shared`, enqueues when signed in, otherwise
  stores items and opens the app (`getSharedItems`/`sharedItems`, UI routes to
  /settings). Photo backup: MediaStore `Files` query by `_ID` watermark (only
  media added after enabling), periodic (1 h) + content-URI trigger worker,
  Android 13 READ_MEDIA_*, Android 14 partial access reported as `limited`,
  folder from `POST /api/backup/folder`. FCM: `firebase-messaging` always
  linked, Google Services plugin applied only if
  `android/app/google-services.json` exists; `registerPush()` rejects
  `PUSH_NOT_CONFIGURED` otherwise; token synced with `PATCH /api/devices/{id}`
  (WorkManager, retried). APK updater: download + SHA-256 + FileProvider +
  ACTION_VIEW installer, "install unknown apps" flow.
- App: versionName/versionCode from `-PappVersion=X.Y.Z` (contract §1),
  release signing from `ANDROID_KEYSTORE_FILE` + `ANDROID_*` env.
- Web UI (`frontend/src/native/**`): `/settings` (native only, sidebar item)
  with device login/logout, server URL override (Capacitor Preferences,
  applied before render; `api.ts` `API_ORIGIN` is now a live binding with
  `setApiOrigin`, web unchanged), photo backup, upload queue (progress/cancel/
  clear), pending shared items, versions + "check for updates". Landing page
  uses the native picker + `enqueueUpload` when native (folder button hidden).
  Startup: `notifyAppReady()`, APK update prompt, live bundle check
  (`web-bundle.json` via native `CapacitorHttp`, respects `minNativeVersion`,
  Capgo `download` with sha256 checksum + `next()`).
- CI: `build-android.yml`, `build-web-bundle.yml` (workflow_call `version`
  for release; push on `feat/native-mobile` / dispatch = artifacts only).
  `minNativeVersion` comes from `frontend/package.json` `filenexus.minNativeVersion`
  (bump it when a web bundle needs newer native code). Optional secret
  `GOOGLE_SERVICES_JSON` enables FCM in CI builds.

How to verify
- `cd frontend && npm ci && npm run build && npx cap sync`
- `cd frontend/android && ./gradlew assembleDebug :filenexus-native:testDebugUnitTest`
  (needs `ANDROID_HOME` with platforms;android-36, JDK 21).
- Contract replay against the real backend (register → backup folder →
  PATCH push token → TUS create/HEAD/PATCH into `相簿備份/<device>` → revoke)
  passed in-process with FastAPI TestClient.

Not verified (needs a real device/emulator): actual background uploads, share
sheet, photo permission dialogs, FCM delivery, APK install, Capgo bundle
swap/rollback. No emulator was available.

Next / notes for others
- iOS: implement the same `definitions.ts` API; `installApkUpdate` etc. are
  Android-only (reject `unavailable`). `getPlatform()` in `src/native/index.ts`.
- Backend: CORS must allow the WebView origins `https://localhost` (Android)
  and `capacitor://localhost` (iOS) — default `cors_origins: ["*"]` does.
- Pre-existing ESLint errors (not from this workstream) remain in
  `src/contexts/AuthContext.tsx`, `src/contexts/ThemeContext.tsx`,
  `src/hooks/useUserDashboard.ts`; all files touched here lint clean.

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

## 2026-10-13 — Backend complete (`feat/native-backend`)
- Done: Implemented section 3. Idempotent `devices` schema in `users.db`
  (UUID IDs, user FK, platform CHECK, unique SHA-256 token hashes, push token,
  creation/last-seen/revocation timestamps). Credentials use 32 random bytes;
  plaintext credentials are returned only at registration. Last-seen writes
  are throttled to one minute using a guarded database update.
- Done: Added POST `/api/devices/register` (JSON/form, password, login rate
  limit, audit), GET `/api/devices`, self-device PATCH, self-device or owner
  session/access DELETE, and device-only POST `/api/backup/folder`.
  Backup folders reuse sanitized `相簿備份/<device_name>` file folders.
- Done: Switched owner checks in core auth, files, folders, users, TUS, and
  per-user WebSockets to async resolution. Bearer/form/query/TUS metadata
  credentials support device tokens; shares retain single-file scope.
- Done: TUS validates owned destinations, preserves relative directory paths,
  uses the account's physical storage folder, records the uploading device,
  and rechecks revocation on continuation. New metadata omits plaintext
  passwords/device tokens. Upload URLs retain documented Uppy continuation
  compatibility while checking the originating credential.
- Done: Added per-user 30-second FCM batches for TUS/legacy upload completion,
  recipient-specific origin exclusion, Android-only active registrations,
  OAuth via google-auth and timeout-bounded httpx, stale FCM token cleanup,
  error isolation, disabled startup warning, and shutdown cancellation.
- Tests: 39 new cases plus all 51 existing cases pass. Tests mock only the
  OAuth/FCM HTTP transport for push; credential parsing/signing, timers,
  database mutations, routes, uploads, and cleanup run real code.
- Red summary (verbatim): `34 failed, 51 passed, 7 warnings in 15.96s`
- Green summary (verbatim): `90 passed, 77 warnings in 58.48s`
- Additional red-before-green regressions cover invalid FCM configuration,
  revoked-device resume, valid-password fallback after token failure,
  expired-session resume, and changed-password resume. Independent review
  reproduced the continuation bugs and verified their fixes: four targeted
  regression cases passed; no important findings remain.
- Checks: Ruff F/I checks and `git diff --check` pass. Test warnings originate
  in existing Pydantic/TUS datetime and SQLite-adapter deprecations.
- Next: Client integration and real Firebase deployment configuration; no
  backend implementation remains open. Actual Firebase delivery was not
  attempted without production credentials. Push timers are process-local
  and in memory; this limitation is documented in the contract.
- Verify: `timeout 300 /home/ubuntu/.claude/jobs/a7fd3792/tmp/venv/bin/python -m pytest backend/tests -q`
  Configure `PUSH__FCM_SERVICE_ACCOUNT_FILE` for deployment (Docker path under
  `/app/data/secrets/` uses the existing persistent mount).
- Shared-file ownership note: `.env example`, `docs/NATIVE_APPS.md`, and this
  progress log were updated as explicitly required by the backend task.

## 2026-10-13 — Backend red phase (`feat/native-backend`)
- Done: Added 34 native device/push regression cases before implementation.
  Registration/management routes are absent (404); FCM module is absent.
  All 51 existing tests pass.
- Red summary (verbatim): `34 failed, 51 passed, 7 warnings in 15.96s`
- Next: Implement persisted device authentication, scoped endpoints, upload
  placement, and FCM delivery; run the same complete suite to green.
- Verify: `timeout 300 /home/ubuntu/.claude/jobs/a7fd3792/tmp/venv/bin/python -m pytest backend/tests -q`
- Shared-file ownership note: This progress log is required by the contract.

## 2026-10-13 — Integrator
- Base branch `feat/native-apps` created (Docker + Pages + iOS Shortcut page +
  security fixes #21/#22/#25 merged, QR share-link fix).
- `frontend/resources/icon.png` (1024 px PNG) is the app icon source.
- Workstreams launched: Mobile core + Android (Claude), Desktop (Codex),
  Backend devices/push (Codex). iOS starts once the Capacitor scaffold and
  plugin TS API exist.
