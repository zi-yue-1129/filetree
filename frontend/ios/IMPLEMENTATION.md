# iOS implementation and verification plan

The shared TypeScript API remains unchanged. The unsigned archive embeds a native
share extension and uses the existing SPM Capacitor/Capgo dependencies.

1. Implement Foundation TUS protocol validation and exercise metadata, proxy
   Location rewriting, offsets, empty files and non-retryable responses in CI.
2. Keep credentials in each executable's local Keychain. Detect an optional
   entitled App Group from its installed provisioning profile; write a protected
   configuration file there for extension access, without requiring group signing.
3. Persist independent main/extension upload queues, use file-backed background
   URLSession tasks with create/HEAD/PATCH stages, bounded chunks and retries.
   Reconnect tasks at launch and route background completion through AppDelegate.
4. Bridge the complete API, document picker, permissions and local notifications.
   Export original PhotoKit resources, journal asset/resource enqueue state,
   preserve creation-date/localIdentifier checkpoints, and schedule best-effort BG tasks.
5. Share files/media/URLs through group storage when available. Otherwise show
   independent device login and foreground progress in the extension. Never pass
   inaccessible extension paths or credentials through a URL scheme.
6. Archive on macOS CI without signing, verify both Mach-O executables and bundle
   identifiers inside the IPA, publish artifacts, and generate a v2 SideStore source.
7. Download the successful CI artifact on Linux and inspect it independently.
   Record CI evidence and device-only acceptance checks in the progress log.

Runtime acceptance requires a real free-account SideStore installation: keep the
extension during signing, independently log in if no group exists, upload from
Files/Photos/Safari, suspend/relaunch the main app, interrupt network and resume,
revoke a token, verify notifications, limited Photos access, backup checkpoints,
and Capgo next-start/rollback. Force-quitting cancels iOS background transfers;
BG execution and extension lifetime are controlled by iOS.
