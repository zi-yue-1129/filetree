# Native Apps — Progress Log

Newest entries first. Each entry: date, workstream, branch, what is done,
what is next, how to verify. See `docs/NATIVE_APPS.md` for the contract.

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
