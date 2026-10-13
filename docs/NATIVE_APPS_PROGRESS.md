# Native Apps — Progress Log

Newest entries first. Each entry: date, workstream, branch, what is done,
what is next, how to verify. See `docs/NATIVE_APPS.md` for the contract.

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
