import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers
import UserNotifications
import Photos
import os

/// iOS implementation of the shared FileNexusNative TypeScript API.
@objc(FileNexusNativePlugin)
public class FileNexusNativePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    /// Capacitor native identifier.
    public let identifier: String = "FileNexusNativePlugin"
    /// JavaScript plugin name.
    public let jsName: String = "FileNexusNative"
    /// Every promise method in definitions.ts, including runtime permissions.
    public let pluginMethods: [CAPPluginMethod] = [
        "configure", "getConfiguration", "getNativeInfo", "pickFiles", "pickFolder", "enqueueUpload", "getUploads",
        "cancelUpload", "clearFinishedUploads", "getSharedItems", "clearSharedItems", "setPhotoBackup",
        "getPhotoBackupStatus", "runPhotoBackupNow", "registerPush", "canInstallPackages",
        "openInstallPermissionSettings", "installApkUpdate", "checkPermissions", "requestPermissions"
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private let logger: Logger = Logger(subsystem: "cc.spkuan.filenexus", category: "Plugin")
    private var pickerCall: CAPPluginCall?
    /// Whether the open picker serves `pickFolder` (else `pickFiles`).
    private var pickerWantsFolder: Bool = false
    private var observers: [NSObjectProtocol] = []

    /// Forward native lifecycle events while the WebView is alive.
    public override func load() -> Void {
        DispatchQueue.main.async { FileNexusLifecycle.launch() }
        observers.append(NotificationCenter.default.addObserver(forName: .fileNexusUpload, object: nil, queue: .main) { [weak self] notification in
            if let job = notification.object as? NativeUpload { self?.notifyListeners("uploadProgress", data: job.json()) }
        })
        observers.append(NotificationCenter.default.addObserver(forName: .fileNexusShared, object: nil, queue: .main) { [weak self] notification in
            if let data = notification.object as? [String: Any] { self?.notifyListeners("sharedItems", data: data, retainUntilConsumed: true) }
        })
        DispatchQueue.main.async { FileNexusLifecycle.active() }
    }

    deinit { for observer: NSObjectProtocol in observers { NotificationCenter.default.removeObserver(observer) } }

    private func reject(_ call: CAPPluginCall, _ error: Error) -> Void {
        logger.error("Native call \(call.methodName, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
        call.reject(error.localizedDescription, (error as? NativeFailure)?.code ?? "IO_ERROR", error)
    }

    private func execute(_ call: CAPPluginCall, _ operation: @MainActor @escaping () throws -> [String: Any]) -> Void {
        DispatchQueue.main.async {
            do { call.resolve(try operation()) } catch { self.reject(call, error) }
        }
    }

    /// Store credentials in the app-local Keychain and optional protected group file.
    @objc public func configure(_ call: CAPPluginCall) -> Void {
        execute(call) {
            guard let server = call.getString("serverUrl"), let url = URL(string: server), url.scheme == "https",
                  url.host != nil, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
                  url.path.isEmpty || url.path == "/", call.options.keys.contains("deviceToken") else {
                throw NativeFailure("serverUrl must be an HTTPS origin and deviceToken must be provided", code: "INVALID_ARGUMENT")
            }
            guard call.options["deviceToken"] is NSNull || call.options["deviceToken"] is String else {
                throw NativeFailure("deviceToken must be a string or null", code: "INVALID_ARGUMENT")
            }
            let token: String? = call.getString("deviceToken")
            if let token = token, token.isEmpty { throw NativeFailure("deviceToken cannot be empty", code: "INVALID_ARGUMENT") }
            let configuration: NativeConfiguration = NativeConfiguration(serverUrl: server.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
                deviceToken: token, deviceId: token == nil ? nil : call.getString("deviceId"),
                deviceName: token == nil ? nil : call.getString("deviceName"))
            try NativeStorage.configure(configuration)
            try FileNexusLifecycle.engine().configurationChanged()
            _ = try FileNexusLifecycle.importShared()
            return [:]
        }
    }

    /// Read the app-local native configuration.
    @objc public func getConfiguration(_ call: CAPPluginCall) -> Void {
        execute(call) { return try NativeStorage.configuration().json() }
    }

    /// Return the bundle version and free-signing capabilities.
    @objc public func getNativeInfo(_ call: CAPPluginCall) -> Void {
        let version: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        let build: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        call.resolve(["platform": "ios", "versionName": version, "versionCode": Int(build) ?? 0, "pushAvailable": false])
    }

    /// Present a system picker and copy selected files into durable app storage.
    @objc public func pickFiles(_ call: CAPPluginCall) -> Void {
        DispatchQueue.main.async {
            guard self.pickerCall == nil else { self.reject(call, NativeFailure("A file picker is already open", code: "INVALID_ARGUMENT")); return }
            let filters: [String] = call.getArray("mimeTypes", String.self) ?? []
            let types: [UTType] = filters.compactMap { mime in
                if mime == "image/*" { return .image }
                if mime == "video/*" { return .movie }
                if mime == "*/*" { return .item }
                return UTType(mimeType: mime)
            }
            let picker: UIDocumentPickerViewController = UIDocumentPickerViewController(forOpeningContentTypes: types.isEmpty ? [.item] : types, asCopy: true)
            picker.allowsMultipleSelection = call.getBool("multiple") ?? true
            picker.delegate = self
            guard let viewController = self.bridge?.viewController else { self.reject(call, NativeFailure("App view controller is unavailable")); return }
            self.pickerCall = call
            self.pickerWantsFolder = false
            viewController.present(picker, animated: true)
        }
    }

    /// Present a folder picker; its files are copied into app storage with folder-relative paths.
    @objc public func pickFolder(_ call: CAPPluginCall) -> Void {
        DispatchQueue.main.async {
            guard self.pickerCall == nil else { self.reject(call, NativeFailure("A file picker is already open", code: "INVALID_ARGUMENT")); return }
            let picker: UIDocumentPickerViewController = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
            picker.allowsMultipleSelection = false
            picker.delegate = self
            guard let viewController = self.bridge?.viewController else { self.reject(call, NativeFailure("App view controller is unavailable")); return }
            self.pickerCall = call
            self.pickerWantsFolder = true
            viewController.present(picker, animated: true)
        }
    }

    /// Resolve the picker with copied file URLs that survive provider revocation.
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) -> Void {
        guard let call = pickerCall else { return }
        pickerCall = nil
        if pickerWantsFolder {
            guard let folder = urls.first else { reject(call, NativeFailure("The folder picker returned no folder")); return }
            // Copying a whole folder can take a while; keep the UI responsive.
            DispatchQueue.global(qos: .userInitiated).async {
                do { call.resolve(try NativeStorage.copyFolder(folder, to: try NativeStorage.directory("picked"))) } catch { self.reject(call, error) }
            }
            return
        }
        do {
            let directory: URL = try NativeStorage.directory("picked")
            let files: [[String: Any]] = try urls.map { url in
                let copied: URL = try NativeStorage.copy(url, to: directory)
                let attributes: [FileAttributeKey: Any] = try FileManager.default.attributesOfItem(atPath: copied.path)
                return ["uri": copied.absoluteString, "name": url.lastPathComponent,
                    "mimeType": UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream",
                    "size": (attributes[.size] as? NSNumber)?.int64Value ?? -1]
            }
            call.resolve(["files": files])
        } catch { reject(call, error) }
    }

    /// Surface picker cancellation explicitly.
    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) -> Void {
        if let call = pickerCall { reject(call, NativeFailure("File selection was cancelled", code: "CANCELLED")) }
        pickerCall = nil
    }

    /// Persist and start native TUS uploads for local file references.
    @objc public func enqueueUpload(_ call: CAPPluginCall) -> Void {
        execute(call) {
            guard let files = call.getArray("files", JSObject.self), !files.isEmpty else {
                throw NativeFailure("files must be a nonempty array", code: "INVALID_ARGUMENT")
            }
            var ids: [String] = []
            for file: JSObject in files {
                guard let uri = file["uri"] as? String, let url = URL(string: uri), url.isFileURL,
                      let name = file["name"] as? String, let mime = file["mimeType"] as? String else {
                    throw NativeFailure("Each upload requires a local file uri, name and mimeType", code: "INVALID_ARGUMENT")
                }
                ids.append(try FileNexusLifecycle.engine().enqueue(file: url, name: name, mimeType: mime,
                    folderId: call.getString("folderId"), source: "app", relativePath: file["relativePath"] as? String,
                    lastModified: file["lastModified"] as? Double, adopt: try NativeStorage.isPickedCopy(url)))
            }
            return ["jobIds": ids]
        }
    }

    /// Return persisted job snapshots.
    @objc public func getUploads(_ call: CAPPluginCall) -> Void {
        execute(call) { return ["uploads": try FileNexusLifecycle.engine().snapshots().map { $0.json() }] }
    }

    /// Cancel locally and request server-side TUS termination.
    @objc public func cancelUpload(_ call: CAPPluginCall) -> Void {
        Task { @MainActor in
            do {
                guard let id = call.getString("jobId") else { throw NativeFailure("jobId is required", code: "INVALID_ARGUMENT") }
                try await FileNexusLifecycle.engine().cancel(id)
                call.resolve()
            } catch { reject(call, error) }
        }
    }

    /// Remove finished uploads and their retained copies.
    @objc public func clearFinishedUploads(_ call: CAPPluginCall) -> Void {
        execute(call) { try FileNexusLifecycle.engine().clearFinished(); return [:] }
    }

    /// Return pending group-container shares, if the signer supplied a usable group.
    @objc public func getSharedItems(_ call: CAPPluginCall) -> Void {
        execute(call) { return ["items": try FileNexusLifecycle.sharedItems()] }
    }

    /// Delete selected shared items, or all when ids is omitted.
    @objc public func clearSharedItems(_ call: CAPPluginCall) -> Void {
        execute(call) { try FileNexusLifecycle.clearShared(call.getArray("ids", String.self)); return [:] }
    }

    /// Configure best-effort PhotoKit backup and request access when enabling.
    @objc public func setPhotoBackup(_ call: CAPPluginCall) -> Void {
        Task { @MainActor in
            do {
                guard let enabled = call.getBool("enabled"), let wifiOnly = call.getBool("wifiOnly"), let videos = call.getBool("includeVideos") else {
                    throw NativeFailure("enabled, wifiOnly and includeVideos are required", code: "INVALID_ARGUMENT")
                }
                let backup: PhotoBackup = try FileNexusLifecycle.backup()
                try await backup.configure(enabled: enabled, wifiOnly: wifiOnly, includeVideos: videos)
                call.resolve(backup.status())
            } catch { reject(call, error) }
        }
    }

    /// Return backup permissions, preferences and persisted checkpoints.
    @objc public func getPhotoBackupStatus(_ call: CAPPluginCall) -> Void {
        execute(call) { return try FileNexusLifecycle.backup().status() }
    }

    /// Scan accessible new photos now, reporting any export/network failure.
    @objc public func runPhotoBackupNow(_ call: CAPPluginCall) -> Void {
        Task { @MainActor in
            do { try await FileNexusLifecycle.backup().run(); call.resolve() } catch { reject(call, error) }
        }
    }

    /// Free Apple IDs have no APNs; resolve explicitly as local-only.
    @objc public func registerPush(_ call: CAPPluginCall) -> Void { call.resolve(["token": NSNull(), "localOnly": true]) }

    /// Android installation capability is unavailable on iOS.
    @objc public func canInstallPackages(_ call: CAPPluginCall) -> Void { call.resolve(["allowed": false]) }

    /// Reject the Android-specific install settings action.
    @objc public func openInstallPermissionSettings(_ call: CAPPluginCall) -> Void { call.unavailable("Only available on Android") }

    /// Reject APK installation on iOS.
    @objc public func installApkUpdate(_ call: CAPPluginCall) -> Void { call.unavailable("Only available on Android") }

    @MainActor private func permissions() async -> [String: Any] {
        let settings: UNNotificationSettings = await UNUserNotificationCenter.current().notificationSettings()
        let notifications: String
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: notifications = "granted"
        case .denied: notifications = "denied"
        case .notDetermined: notifications = "prompt"
        @unknown default: notifications = "denied"
        }
        return ["photos": PhotoBackup.permission(), "notifications": notifications]
    }

    /// Check photo and local notification access without prompting.
    @objc public override func checkPermissions(_ call: CAPPluginCall) -> Void {
        Task { @MainActor in call.resolve(await permissions()) }
    }

    /// Request the selected runtime permissions and report their actual results.
    @objc public override func requestPermissions(_ call: CAPPluginCall) -> Void {
        Task { @MainActor in
            do {
                let aliases: [String] = call.getArray("permissions", String.self) ?? ["photos", "notifications"]
                guard aliases.allSatisfy({ ["photos", "notifications"].contains($0) }) else {
                    throw NativeFailure("Unknown permission alias", code: "INVALID_ARGUMENT")
                }
                if aliases.contains("photos") { _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite) }
                if aliases.contains("notifications") {
                    _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
                }
                call.resolve(await permissions())
            } catch { reject(call, error) }
        }
    }
}
