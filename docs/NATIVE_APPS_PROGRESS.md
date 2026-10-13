# Native Apps — Progress Log

Newest entries first. Each entry: date, workstream, branch, what is done,
what is next, how to verify. See `docs/NATIVE_APPS.md` for the contract.

## 2026-10-13 — iOS (Codex), branch `feat/native-ios` — completed implementation / final verification

Done
- Complete iOS FileNexusNative bridge, app-local Keychain (service names also
  separate the two executables if a signer reuses profiles), persisted native
  TUS jobs/original files/offsets, 8 MiB file-backed background PATCH tasks,
  background create/HEAD stages, 10-attempt backoff using earliestBeginDate,
  local notifications and JS events, server termination and native picker.
  HTTP 200 fingerprint resume, zero-byte PATCH finalization, token/origin
  changes, suspension/reconnect, and permanent-vs-retryable failures are handled.
- PhotoKit originals (including RAW alternates and optional Live Photo video),
  creation-date + localIdentifier scan/completion checkpoints, per-resource
  enqueue deduplication, failed-asset retry identities that survive queue cleanup,
  50-asset scans, permission status, activation/change triggers and best-effort
  BGProcessingTask/BGAppRefreshTask. Mutable async services are MainActor-isolated.
- Embedded ShareExtension accepts files/images/videos/URLs; URLs become text
  files. **Default free SideStore path:** no mandatory App Group or Keychain
  sharing entitlement; independent extension device login and visible foreground
  URLSession uploads until completion. Cancel stops retries and cancels pending
  jobs. This is the selected path for unsigned IPA/free signing.
- **Optional group path:** detect the actual installed profile's group entitlement
  and verify container access; protected configuration/inbox files; independent
  background session with sharedContainerIdentifier, reconnected by AppDelegate.
  SideStore's signing code appends Team ID to group identifiers, so hardcoded
  container names fail after resigning. Reading provisioned identifiers avoids
  that mismatch. No extension-private file path or token is passed in a URL.
  Evidence: https://github.com/SideStore/SideStore/blob/develop/SideStore/Core/Operations/PipelineOperations/FetchProvisioningProfilesOperation.swift
- Existing generated icon retained. Capgo SPM linking, manual mode and 10-second
  rollback timeout verified in the actual IPA. Build workflow uses macos-15 with
  Xcode 26.3; workflow_call release mode and push/dispatch artifacts-only mode;
  versioned unsigned IPA plus v2 source JSON and inspection report. Release mode
  requires an existing draft; it is configured but not invoked by test pushes.
- Friend-facing zh-TW instructions: docs/IOS_SIDELOAD.md. SideStore docs checked
  live: LocalDevVPN + iLoader are current; pairing, seven-day refresh, three-app /
  ten-App-ID limits, keeping the extension, Photos and notification access covered.

CI and artifact evidence
- https://github.com/zi-yue-1129/filetree/actions/runs/38384742467 — SUCCESS,
  Xcode 26.3 archive, executable protocol checks, 8/8 iOS simulator tests.
  Downloaded and independently inspected on Linux: Payload/App.app/App and
  Payload/App.app/PlugIns/ShareExtension.appex/ShareExtension; correct bundle IDs,
  arm64 Mach-O, no LC_CODE_SIGNATURE in either executable; Capgo and plugin
  registration present. IPA size 5,694,749 bytes; source JSON size matches.
- https://github.com/zi-yue-1129/filetree/actions/runs/38385463939 — SUCCESS,
  final implementation commit 850bcf6: protocol checks, archive, **10/10 simulator
  tests**, IPA packaging/identity/arm64/unsigned checks and artifact upload passed.
  This adds acknowledged-offset resume and durable retry regressions. Downloaded
  final-code IPA independently: both executables present, arm64, no code signature;
  bundle versions 0.0.1; native/Capgo registration and manual-update settings present.
  IPA size 5,695,219 bytes; SHA256:
  `adb7d785787c2bba1891a0094bebafd09b71ee08edd8959f36688c4def5e9b75`.
  The accompanying v2 source JSON advertises the exact byte size. Documentation-only
  handoff commit will trigger the same build gate again; no runtime changes follow.
- Earlier runs 38382598162 and 38383520518 failed on lipo argument order and
  hostless XCTest notification-center access, respectively; both were fixed.
  Simulator tests inject notification delivery; actual notification permission /
  presentation remain device checks. URLProtocol fixtures exercise the production
  queue using foreground file tasks; they do not verify Apple's background daemon.

Real iPhone acceptance and limitations
- Install/re-sign via a free Apple ID in SideStore, keep the extension, verify
  independent extension login, Files/Photos/Safari providers and large media.
  Without a group, keep the share UI open; iOS can terminate an extension under
  resource pressure. Its jobs/credentials are separate from the main app queue;
  revoke the "iPhone 分享" device to sign out of that path. Main logout alone does
  not revoke its token. Optional rewritten App Group mode remains unverified.
- Verify background suspend/relaunch, network interruption and resume, cancellation,
  token revocation, local notifications, limited/full Photos access, RAW/Live Photo
  originals, creation-date ties, failed-asset retry, BG expiration/scheduling and
  Capgo next-start/rollback. No APNs under free signing. Force-quit cancels system
  transfers; iOS determines BG execution opportunities.
- Wi-Fi-only backup uploads are constrained; iCloud-only originals are not fetched
  in this mode and surface an export error. Download originals in Photos first.
  New-asset selection starts at enable time; imports dated before the creation
  checkpoint require manual picker/share upload.
- Ownership: only iOS-owned files and this shared progress log changed. The shared
  TypeScript API, Capacitor configuration and backend contract remain unchanged.

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

## 2026-10-13 — Integrator: v0.1.0 released
- Tag `v0.1.0` (commit f8dbc74) → run 38389304390: all 9 jobs green
  (prepare, web-bundle, android, ios, desktop linux/windows/macos,
  desktop publish, publish). Release is published and latest:
  https://github.com/zi-yue-1129/filetree/releases/tag/v0.1.0
- Verified via `releases/latest/download/`: `web-bundle.json`,
  `android.json`, `sidestore-source.json`, `latest.json` resolve with correct
  URLs. Downloaded APK sha256 matches `android.json`; `apksigner` signer
  certificate SHA-256 `3c709a30…e741708c` equals the release keystore
  (`CN=FileNexus, O=FileNexus, C=TW`).
- Known gaps: no real-device testing yet on any platform; the app default API
  URL is still the placeholder `https://api-filetree.spkuan.cc` (users can
  override it in Settings); `--generate-notes` produced unhelpful release
  notes (only lists PR #2) — consider hand-written notes for v0.1.1+.

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

## 2026-10-13 — Desktop final verification — `feat/native-desktop`

- Implementation complete at `d84f2132002872e510897f3bf7fa8d47f9db616b`.
  Tauri v2 wraps the shared React frontend; icons were generated with `tauri icon`
  from `frontend/resources/icon.png`. Tray, single instance, close-to-tray,
  opt-in persisted autostart, persisted server override, startup/six-hour updates,
  release-note dialogs/install/relaunch, and hidden/unfocused REFRESH notifications
  are implemented. `dragDropEnabled: false` preserves HTML5 file-drop handling.
- No shared frontend source, dependencies, or import/call sites were changed.
  Desktop JS dependencies live in `desktop/package.json`; the native bridge is
  bundled independently and injected before React. Server changes clear saved
  authentication before persisting the new origin. Corrupt settings fail visibly.
- Added `.github/workflows/build-desktop.yml` with reusable release mode and
  artifact-only push/manual mode. Release mode uses the caller's version, signed
  bundles, format-specific updater entries, one merged `latest.json`, and uploads
  to an existing release only. Added requested zh-TW `docs/DESKTOP.md`.

### CI evidence

Final [run 38379332331](https://github.com/zi-yue-1129/filetree/actions/runs/38379332331)
completed successfully on the implementation SHA above:

| OS | Result | Outputs |
| --- | --- | --- |
| Windows | Success | NSIS EXE + MSI + both signatures + manifest fragment |
| macOS universal | Success | DMG + universal `.app.tar.gz` + signature + manifest fragment |
| Ubuntu 22.04 | Success | AppImage + DEB + both signatures + manifest fragment |
| Release publication | Skipped as intended | Push build uploaded workflow artifacts only |

Earlier iterations (all failures fixed in the final run):

| Run | Windows | macOS | Linux | Diagnosis |
| --- | --- | --- | --- | --- |
| [38377947564](https://github.com/zi-yue-1129/filetree/actions/runs/38377947564) | Failure | Failure | Failure | Public-key variable name mismatch; macOS needed GNU timeout |
| [38378204269](https://github.com/zi-yue-1129/filetree/actions/runs/38378204269) | Failure | Failure | Failure | Cargo `--locked` needed forwarding after Tauri's `--` |
| [38378577395](https://github.com/zi-yue-1129/filetree/actions/runs/38378577395) | Failure | Success | Failure | Windows ESM import needed file URL; macOS-only autostart API needed cfg |
| [38378914020](https://github.com/zi-yue-1129/filetree/actions/runs/38378914020) | Failure | Success | Failure | Confirmed macOS-only autostart API issue on Windows/Linux |

- Local verification: frontend production build and desktop build preparation,
  TypeScript check, eight regression tests, Rust formatting, and diff checks pass.
  Local native compilation is unavailable (missing DBus/WebKitGTK system libraries);
  native compilation and packaging passed independently on all CI platforms.
- Downloaded final artifacts and cryptographically verified all five updater
  signatures and signed `version:0.1.0` comments against `TAURI_UPDATER_PUBKEY`.
  Merged the actual manifest fragments locally: ten platform/installer-format
  entries. Inspected the final Mac archive: Intel x86_64 + Apple Silicon arm64
  Mach-O and `cc.spkuan.filenexus` bundle identifier confirmed.
- Independent review findings were fixed and regression-tested: clearing prior
  server credentials and preserving NSIS/MSI/AppImage/DEB update formats.

### Remaining integration and acceptance

- Owner settings now exist: secrets `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; variables `TAURI_UPDATER_PUBKEY` and
  `VITE_API_BASE_URL`. Keep these exact names. No paid platform-signing secrets
  are required. Private key/password values were not read or exposed.
- Configured API is `https://api-filetree.spkuan.cc`. It did not resolve locally;
  Cloudflare DNS-over-HTTPS returned no A or AAAA answers at verification time.
  Owner must make the endpoint reachable or choose a working server override.
  Production CORS acceptance for `tauri://localhost` and
  `http://tauri.localhost` remains for backend/integrator verification.
- Integrator must create `v<version>` and call the reusable workflow with
  `version` and `secrets: inherit`. Live release publication and a signed update
  between two installed versions were not exercised; no release was created.
- Real Windows/macOS installation acceptance remains: HTML5 file drops, tray
  visibility/activation, login registration, OS notification permissions, and
  successful install/relaunch. Builds are not paid-code-signed or Apple-notarized;
  installation bypass instructions are in `docs/DESKTOP.md`.
- This final entry is a documentation-only commit after the verified build SHA;
  installer source and workflow remain identical to the successful run.

## 2026-10-13 — Desktop — `feat/native-desktop`
- Implemented Tauri v2 project, generated icons, tray/close-to-tray,
  single-instance activation, persisted opt-in autostart and server origin,
  startup/six-hour updater checks with release-note dialogs, and local REFRESH
  notifications for hidden/unfocused per-user WebSockets.
- Added independent desktop bridge bundling and desktop-only Vite origin
  transformation. No changes to shared frontend source/dependencies/imports.
- Added reusable/push/manual three-OS installer workflow, signed updater
  manifest merge, and zh-TW `docs/DESKTOP.md` (explicitly requested documentation
  outside the contract's Desktop path table).
- Local frontend build, desktop frontend build, TS check, notification test,
  four updater manifest tests, and Rust formatting pass. Native compilation
  requires CI because this machine has no WebKitGTK.
- CI: first branch build pending push. Release publication and real-machine
  tray/drop/autostart/notification/update acceptance remain unverified.
- Owner configuration needed: secrets `TAURI_SIGNING_PRIVATE_KEY` and optional
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; variables `TAURI_UPDATER_PUBKEY`
  and `VITE_API_BASE_URL`. No repository variables were configured at inspection.
  Backend/integrator must allow Tauri origins in CORS and call the reusable
  workflow after creating the release. Test builds explicitly warn and use
  localhost when no production API is configured.

## 2026-10-13 — Integrator
- Base branch `feat/native-apps` created (Docker + Pages + iOS Shortcut page +
  security fixes #21/#22/#25 merged, QR share-link fix).
- `frontend/resources/icon.png` (1024 px PNG) is the app icon source.
- Workstreams launched: Mobile core + Android (Claude), Desktop (Codex),
  Backend devices/push (Codex). iOS starts once the Capacitor scaffold and
  plugin TS API exist.
