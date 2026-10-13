# Desktop implementation plan

The specification is `../docs/NATIVE_APPS.md` plus the Desktop workstream request.
Work stays in the existing `feat/native-desktop` worktree.

1. Build a Tauri v2 shell with pinned dependencies, generated icons, and a
   desktop-only Vite configuration that reuses the frontend configuration.
   Inject a bundled desktop bridge before the React application starts; no
   shared frontend dependencies or import sites need to change.
2. Implement Rust tray, single-instance activation, close-to-tray, opt-in
   autostart persisted in store, startup/six-hour updates, and native error
   dialogs. Keep the webview drop interception disabled.
3. Observe the application's existing per-user WebSockets for hidden/unfocused
   REFRESH notifications. Add a tray-accessible server override editor and seed
   the persisted origin before React evaluates the API service.
4. Build installers in a three-OS workflow. Require keys and the API origin in
   release mode; explicitly disable updater artifact signing in unsigned test
   mode. Collect platform manifests, merge once, and upload only to an existing
   release. Test malformed manifests, missing signatures, duplicate platforms,
   and universal macOS mappings.
5. Verify TypeScript, the frontend build, Rust formatting, scripts, and fresh CI.
   Document installation/key setup in zh-TW. Commit and push only this branch;
   append final CI evidence and remaining owner configuration to the progress log.

Runtime acceptance on installed Windows/macOS still requires a real machine:
HTML5 file drops, notification permission, tray visibility, login registration,
and a signed update/relaunch against an actual GitHub release.
