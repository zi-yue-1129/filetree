# Native Apps — Progress Log

Newest entries first. Each entry: date, workstream, branch, what is done,
what is next, how to verify. See `docs/NATIVE_APPS.md` for the contract.

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
