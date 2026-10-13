import Foundation
import Capacitor

/// iOS implementation of the `FileNexusNative` Capacitor plugin.
///
/// Skeleton owned by the iOS workstream: every method from
/// `native-plugin/src/definitions.ts` is registered and currently rejects with
/// `unimplemented` until the iOS feature work lands.
@objc(FileNexusNativePlugin)
public class FileNexusNativePlugin: CAPPlugin, CAPBridgedPlugin {
    /// Native identifier used by Capacitor.
    public let identifier = "FileNexusNativePlugin"
    /// Name exposed to JavaScript.
    public let jsName = "FileNexusNative"
    /// Methods bridged to JavaScript.
    public let pluginMethods: [CAPPluginMethod] = [
        "configure", "getConfiguration", "getNativeInfo", "pickFiles",
        "enqueueUpload", "getUploads", "cancelUpload", "clearFinishedUploads",
        "getSharedItems", "clearSharedItems", "setPhotoBackup",
        "getPhotoBackupStatus", "runPhotoBackupNow", "registerPush",
        "canInstallPackages", "openInstallPermissionSettings", "installApkUpdate",
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }

    /// Persist server URL and device credentials.
    @objc func configure(_ call: CAPPluginCall) { call.unimplemented("configure is not implemented yet") }
    /// Return persisted credentials.
    @objc func getConfiguration(_ call: CAPPluginCall) { call.unimplemented("getConfiguration is not implemented yet") }
    /// Return native version information.
    @objc func getNativeInfo(_ call: CAPPluginCall) { call.unimplemented("getNativeInfo is not implemented yet") }
    /// Open the system document picker.
    @objc func pickFiles(_ call: CAPPluginCall) { call.unimplemented("pickFiles is not implemented yet") }
    /// Queue background uploads.
    @objc func enqueueUpload(_ call: CAPPluginCall) { call.unimplemented("enqueueUpload is not implemented yet") }
    /// List upload jobs.
    @objc func getUploads(_ call: CAPPluginCall) { call.unimplemented("getUploads is not implemented yet") }
    /// Cancel one upload job.
    @objc func cancelUpload(_ call: CAPPluginCall) { call.unimplemented("cancelUpload is not implemented yet") }
    /// Forget finished upload jobs.
    @objc func clearFinishedUploads(_ call: CAPPluginCall) { call.unimplemented("clearFinishedUploads is not implemented yet") }
    /// Return pending share-extension items.
    @objc func getSharedItems(_ call: CAPPluginCall) { call.unimplemented("getSharedItems is not implemented yet") }
    /// Delete pending share-extension items.
    @objc func clearSharedItems(_ call: CAPPluginCall) { call.unimplemented("clearSharedItems is not implemented yet") }
    /// Configure photo backup.
    @objc func setPhotoBackup(_ call: CAPPluginCall) { call.unimplemented("setPhotoBackup is not implemented yet") }
    /// Return photo backup status.
    @objc func getPhotoBackupStatus(_ call: CAPPluginCall) { call.unimplemented("getPhotoBackupStatus is not implemented yet") }
    /// Trigger a photo backup scan.
    @objc func runPhotoBackupNow(_ call: CAPPluginCall) { call.unimplemented("runPhotoBackupNow is not implemented yet") }
    /// Register for push (iOS: local notifications only).
    @objc func registerPush(_ call: CAPPluginCall) { call.unimplemented("registerPush is not implemented yet") }
    /// Android only.
    @objc func canInstallPackages(_ call: CAPPluginCall) { call.resolve(["allowed": false]) }
    /// Android only.
    @objc func openInstallPermissionSettings(_ call: CAPPluginCall) { call.unavailable("Only available on Android") }
    /// Android only.
    @objc func installApkUpdate(_ call: CAPPluginCall) { call.unavailable("Only available on Android") }
}
