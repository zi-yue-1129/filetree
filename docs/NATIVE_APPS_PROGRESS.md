# Native Apps — Progress Log

Newest entries first. Each entry: date, workstream, branch, what is done,
what is next, how to verify. See `docs/NATIVE_APPS.md` for the contract.

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
