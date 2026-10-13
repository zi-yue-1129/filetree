import Foundation
import UIKit
import BackgroundTasks
import os

extension Notification.Name {
    static let fileNexusUpload: Notification.Name = Notification.Name("FileNexusUpload")
    static let fileNexusShared: Notification.Name = Notification.Name("FileNexusShared")
}

/// Process-lifetime services, also initialized when iOS relaunches without a WebView.
@MainActor
public enum FileNexusLifecycle {
    private static var uploadEngine: UploadEngine?
    private static var photoBackup: PhotoBackup?
    private static var extensionEngines: [String: UploadEngine] = [:]
    private static var registered: Bool = false
    private static let logger: Logger = Logger(subsystem: "cc.spkuan.filenexus", category: "Lifecycle")

    /// Initialize persistence and reconnect transfers before UI/plugin loading.
    public static func launch() -> Void {
        do { _ = try engine(); _ = try backup() } catch {
            logger.error("Native startup failed: \(error.localizedDescription, privacy: .public)")
        }
        if !registered {
            registered = true
            for identifier: String in [PhotoBackup.processingIdentifier, PhotoBackup.refreshIdentifier] {
                let accepted: Bool = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main) { task in
                    let worker: Task<Void, Never> = Task { @MainActor in
                        do { try await backup().run(); task.setTaskCompleted(success: true) } catch {
                            logger.error("Background backup failed: \(error.localizedDescription, privacy: .public)")
                            task.setTaskCompleted(success: false)
                        }
                    }
                    task.expirationHandler = { worker.cancel() }
                }
                if !accepted { logger.error("Background task registration rejected: \(identifier, privacy: .public)") }
            }
        }
    }

    /// Resume uploads, receive shared files, and scan Photos when the scene activates.
    public static func active() -> Void {
        Task { @MainActor in
            do { try engine().resume(); _ = try importShared(); try await backup().run() } catch {
                logger.error("Native activation failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    /// Schedule future backup windows as the app leaves the foreground.
    public static func background() -> Void {
        do { try backup().schedule() } catch { logger.error("Cannot schedule backup: \(error.localizedDescription)") }
    }

    /// Reconnect the correct executable's session and retain Apple's completion callback.
    public static func backgroundSession(_ identifier: String, completion: @escaping () -> Void) -> Void {
        do {
            let main: UploadEngine = try engine()
            if identifier == main.sessionIdentifier {
                main.backgroundCompletion = completion
            } else if identifier.contains(".share"), identifier.hasSuffix(".uploads"), let group = try NativeStorage.appGroup() {
                let extensionEngine: UploadEngine
                if let existing = extensionEngines[identifier] { extensionEngine = existing } else {
                    extensionEngine = try UploadEngine(directory: NativeStorage.directory("extension-uploads", shared: true),
                        identifier: identifier, groupIdentifier: group.0)
                    extensionEngine.configurationProvider = {
                        guard let configuration = try NativeStorage.read(NativeConfiguration.self,
                                from: group.1.appendingPathComponent("configuration.json")) else {
                            throw NativeFailure("Shared credentials are unavailable", code: "NOT_CONFIGURED")
                        }
                        return configuration
                    }
                    extensionEngines[identifier] = extensionEngine
                }
                extensionEngine.backgroundCompletion = completion
            } else {
                throw NativeFailure("Unknown background URLSession identifier")
            }
        } catch {
            logger.error("Cannot reconnect background transfer: \(error.localizedDescription, privacy: .public)")
            completion()
        }
    }

    /// Return the process-owned main app upload engine.
    static func engine() throws -> UploadEngine {
        if let engine = uploadEngine { return engine }
        let identifier: String = (Bundle.main.bundleIdentifier ?? "cc.spkuan.filenexus") + ".uploads"
        let engine: UploadEngine = try UploadEngine(directory: NativeStorage.directory("uploads"), identifier: identifier)
        engine.onProgress = { job in
            photoBackup?.uploaded(job)
            NotificationCenter.default.post(name: .fileNexusUpload, object: job)
        }
        uploadEngine = engine
        return engine
    }

    /// Return the process-owned PhotoKit backup service.
    static func backup() throws -> PhotoBackup {
        if let backup = photoBackup { return backup }
        let backup: PhotoBackup = try PhotoBackup(engine: engine())
        photoBackup = backup
        return backup
    }

    /// Read share manifests only from a genuinely accessible App Group.
    static func sharedItems() throws -> [[String: Any]] {
        guard try NativeStorage.appGroup() != nil else { return [] }
        let directory: URL = try NativeStorage.directory("share-inbox", shared: true)
        let urls: [URL] = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        return try urls.filter { $0.pathExtension == "json" }.map {
            guard let item = try JSONSerialization.jsonObject(with: Data(contentsOf: $0)) as? [String: Any] else {
                throw NativeFailure("Share inbox contains an invalid manifest")
            }
            return item
        }
    }

    /// Remove selected pending shares and their owned copies.
    static func clearShared(_ ids: [String]?) throws -> Void {
        guard try NativeStorage.appGroup() != nil else { return }
        let directory: URL = try NativeStorage.directory("share-inbox", shared: true)
        for item: [String: Any] in try sharedItems() {
            guard let id = item["id"] as? String, ids == nil || ids?.contains(id) == true,
                  let uri = item["uri"] as? String, let file = URL(string: uri),
                  file.deletingLastPathComponent().standardizedFileURL == directory.standardizedFileURL else { continue }
            if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
            try FileManager.default.removeItem(at: directory.appendingPathComponent(id + ".json"))
        }
    }

    /// Enqueue shared manifests idempotently after app activation or device login.
    @discardableResult
    static func importShared() throws -> [String] {
        let items: [[String: Any]] = try sharedItems()
        guard try NativeStorage.configuration().deviceToken != nil else {
            if !items.isEmpty {
                NotificationCenter.default.post(name: .fileNexusShared, object: ["items": items, "enqueuedJobIds": []] as [String: Any])
            }
            return []
        }
        var ids: [String] = []
        for item: [String: Any] in items {
            guard let uri = item["uri"] as? String, let file = URL(string: uri), let name = item["name"] as? String,
                  let mime = item["mimeType"] as? String, let id = item["id"] as? String else {
                throw NativeFailure("Share manifest is incomplete")
            }
            let directory: URL = try NativeStorage.directory("share-inbox", shared: true)
            guard file.deletingLastPathComponent().standardizedFileURL == directory.standardizedFileURL else {
                throw NativeFailure("Share manifest references a file outside the inbox")
            }
            ids.append(try engine().enqueue(file: file, name: name, mimeType: mime, folderId: nil, source: "share", backupKey: "share:" + id))
            try clearShared([id])
        }
        if !items.isEmpty {
            NotificationCenter.default.post(name: .fileNexusShared, object: ["items": [], "enqueuedJobIds": ids] as [String: Any])
        }
        return ids
    }
}

