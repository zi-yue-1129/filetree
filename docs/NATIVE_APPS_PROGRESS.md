# Native Apps — Progress Log

Newest entries first. Each entry: date, workstream, branch, what is done,
what is next, how to verify. See `docs/NATIVE_APPS.md` for the contract.

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
