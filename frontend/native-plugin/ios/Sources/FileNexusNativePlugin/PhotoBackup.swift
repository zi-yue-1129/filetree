import Foundation
import Photos
import UIKit
import BackgroundTasks
import UniformTypeIdentifiers
import os

/// Persisted photo selection and both enqueue/completion checkpoints.
struct BackupState: Codable {
    var enabled: Bool = false
    var wifiOnly: Bool = true
    var includeVideos: Bool = false
    var folderId: String?
    var deviceId: String?
    var lastRunAt: Double?
    var lastBackedUpAt: Double?
    var lastIdentifier: String = ""
    var lastUploadedAt: Double?
    var lastUploadedIdentifier: String = ""
    var enqueuedCount: Int = 0
    var lastError: String?
    var retryAssets: [String]?
    var baseline: Double = Date().timeIntervalSince1970 * 1000
}

/// Original-resource PhotoKit backup with resumable, idempotent enqueue checkpoints.
@MainActor
final class PhotoBackup: NSObject, PHPhotoLibraryChangeObserver {
    static let processingIdentifier: String = "cc.spkuan.filenexus.backup.processing"
    static let refreshIdentifier: String = "cc.spkuan.filenexus.backup.refresh"
    private let engine: UploadEngine
    private let stateFile: URL
    private var state: BackupState
    private var running: Bool = false
    private let logger: Logger = Logger(subsystem: "cc.spkuan.filenexus", category: "Backup")

    /// Restore backup preferences before registering PhotoKit change callbacks.
    init(engine: UploadEngine) throws {
        self.engine = engine
        self.stateFile = try NativeStorage.directory("backup").appendingPathComponent("state.json")
        self.state = try NativeStorage.read(BackupState.self, from: self.stateFile) ?? BackupState()
        super.init()
        if [.authorized, .limited].contains(PHPhotoLibrary.authorizationStatus(for: .readWrite)) {
            PHPhotoLibrary.shared().register(self)
        }
    }

    /// Map PhotoKit's authorization to the contract permission strings.
    static func permission() -> String {
        switch PHPhotoLibrary.authorizationStatus(for: .readWrite) {
        case .authorized: return "granted"
        case .limited: return "limited"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "prompt"
        @unknown default: return "denied"
        }
    }

    /// Return user-visible settings and scan progress.
    func status() -> [String: Any] {
        return ["enabled": state.enabled, "wifiOnly": state.wifiOnly, "includeVideos": state.includeVideos,
                "permission": Self.permission(), "folderId": state.folderId as Any? ?? NSNull(),
                "lastRunAt": state.lastRunAt as Any? ?? NSNull(), "lastBackedUpAt": state.lastBackedUpAt as Any? ?? NSNull(),
                "enqueuedCount": state.enqueuedCount, "lastError": state.lastError as Any? ?? NSNull()]
    }

    /// Request Photos access and persist an explicit enable/disable decision.
    func configure(enabled: Bool, wifiOnly: Bool, includeVideos: Bool) async throws -> Void {
        if enabled, PHPhotoLibrary.authorizationStatus(for: .readWrite) == .notDetermined {
            _ = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        }
        if enabled, !state.enabled {
            state.baseline = Date().timeIntervalSince1970 * 1000
            state.lastBackedUpAt = nil
            state.lastIdentifier = ""
            state.enqueuedCount = 0
        }
        state.enabled = enabled && ["granted", "limited"].contains(Self.permission())
        state.wifiOnly = wifiOnly
        state.includeVideos = includeVideos
        UserDefaults.standard.set(wifiOnly, forKey: "backup.wifiOnly")
        try save()
        if state.enabled {
            PHPhotoLibrary.shared().register(self)
            schedule()
            Task { do { try await self.run() } catch { self.logger.error("Initial backup failed: \(error.localizedDescription)") } }
        } else {
            PHPhotoLibrary.shared().unregisterChangeObserver(self)
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.processingIdentifier)
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshIdentifier)
        }
    }

    /// Scan in chronological order and enqueue each original resource only once.
    func run() async throws -> Void {
        guard state.enabled, !running else { return }
        guard ["granted", "limited"].contains(Self.permission()) else {
            throw NativeFailure("Photo library access was denied", code: "PERMISSION_DENIED")
        }
        running = true
        defer { running = false; schedule() }
        do {
            try Task.checkCancellation()
            let configuration: NativeConfiguration = try NativeStorage.configuration()
            let credentials: (URL, String) = try configuration.credentials()
            if state.deviceId != configuration.deviceId { state.folderId = nil; state.deviceId = configuration.deviceId }
            if state.folderId == nil {
                var request: URLRequest = URLRequest(url: credentials.0.appendingPathComponent("api/backup/folder"))
                request.httpMethod = "POST"
                request.timeoutInterval = 30
                request.allowsCellularAccess = !state.wifiOnly
                request.allowsExpensiveNetworkAccess = !state.wifiOnly
                request.setValue("Bearer " + credentials.1, forHTTPHeaderField: "Authorization")
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: ["device_name": configuration.deviceName ?? UIDevice.current.name])
                let (data, response): (Data, URLResponse) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                      let result = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let folder = result["folder_id"] as? String, !folder.isEmpty else {
                    throw NativeFailure("Cannot create or resolve the photo backup folder")
                }
                state.folderId = folder
                try save()
            }
            try engine.retryFailedBackup()
            let options: PHFetchOptions = PHFetchOptions()
            let startDate: Date = Date(timeIntervalSince1970: (state.lastBackedUpAt ?? state.baseline) / 1000)
            options.predicate = NSPredicate(format: "creationDate >= %@", startDate as NSDate)
            options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
            let fetched: PHFetchResult<PHAsset> = PHAsset.fetchAssets(with: options)
            var assets: [PHAsset] = []
            fetched.enumerateObjects { asset, _, _ in assets.append(asset) }
            let retryIds: [String] = state.retryAssets ?? []
            let retryFetched: PHFetchResult<PHAsset> = PHAsset.fetchAssets(withLocalIdentifiers: retryIds, options: nil)
            retryFetched.enumerateObjects { asset, _, _ in
                if !assets.contains(where: { $0.localIdentifier == asset.localIdentifier }) { assets.append(asset) }
            }
            assets.sort {
                let left: Date = $0.creationDate ?? .distantPast
                let right: Date = $1.creationDate ?? .distantPast
                return left == right ? $0.localIdentifier < $1.localIdentifier : left < right
            }
            var processed: Int = 0
            for asset: PHAsset in assets {
                try Task.checkCancellation()
                guard let creation = asset.creationDate else { throw NativeFailure("Photo asset has no creation date") }
                let timestamp: Double = creation.timeIntervalSince1970 * 1000
                if !retryIds.contains(asset.localIdentifier), let last = state.lastBackedUpAt, timestamp == last && asset.localIdentifier <= state.lastIdentifier { continue }
                if asset.mediaType == .video && !state.includeVideos { continue }
                let resources: [PHAssetResource] = PHAssetResource.assetResources(for: asset).filter {
                    $0.type == .photo || (state.includeVideos && ($0.type == .video || $0.type == .pairedVideo))
                }
                guard !resources.isEmpty else { throw NativeFailure("Photo asset has no exportable original resource") }
                for (index, resource): (Int, PHAssetResource) in resources.enumerated() {
                    try Task.checkCancellation()
                    let key: String = asset.localIdentifier + ":" + String(index) + ":" + resource.originalFilename
                    if engine.snapshots().contains(where: { $0.backupKey == key && $0.state != "cancelled" }) { continue }
                    let temporary: URL = try NativeStorage.directory("backup").appendingPathComponent(UUID().uuidString)
                    let exportOptions: PHAssetResourceRequestOptions = PHAssetResourceRequestOptions()
                    // Cloud originals are fetched only during unconstrained backups; Wi-Fi-only
                    // backups surface an iCloud-export error rather than using cellular data.
                    exportOptions.isNetworkAccessAllowed = !state.wifiOnly
                    try await export(resource, to: temporary, options: exportOptions)
                    try Task.checkCancellation()
                    let mime: String = UTType(resource.uniformTypeIdentifier)?.preferredMIMEType ?? "application/octet-stream"
                    _ = try engine.enqueue(file: temporary, name: resource.originalFilename, mimeType: mime,
                        folderId: state.folderId, source: "backup", lastModified: timestamp, wifiOnly: state.wifiOnly, backupKey: key, backupResourceCount: resources.count)
                    try FileManager.default.removeItem(at: temporary)
                    state.enqueuedCount += 1
                }
                if timestamp > (state.lastBackedUpAt ?? 0) || (timestamp == state.lastBackedUpAt && asset.localIdentifier > state.lastIdentifier) {
                    state.lastBackedUpAt = timestamp
                    state.lastIdentifier = asset.localIdentifier
                }
                try save()
                processed += 1
                if processed >= 50 { break }
            }
            state.lastRunAt = Date().timeIntervalSince1970 * 1000
            state.lastError = nil
            try save()
        } catch {
            state.lastError = error.localizedDescription
            do { try save() } catch { logger.fault("Cannot persist backup error: \(error.localizedDescription)") }
            logger.error("Photo backup failed: \(error.localizedDescription, privacy: .public)")
            throw error
        }
    }

    private func export(_ resource: PHAssetResource, to url: URL, options: PHAssetResourceRequestOptions) async throws -> Void {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            PHAssetResourceManager.default().writeData(for: resource, toFile: url, options: options) { error in
                if let error = error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }

    private func save() throws -> Void { try NativeStorage.write(state, to: stateFile) }

    /// Persist the last fully acknowledged asset identifier and creation date.
    func uploaded(_ job: NativeUpload) -> Void {
        guard job.source == "backup", let key = job.backupKey,
              let timestamp = job.lastModified, let separator = key.firstIndex(of: ":") else { return }
        let identifier: String = String(key[..<separator])
        if job.state == "failed" {
            var retryIds: Set<String> = Set(state.retryAssets ?? [])
            retryIds.insert(identifier)
            state.retryAssets = Array(retryIds).sorted()
            do { try save() } catch { logger.error("Cannot persist failed asset for retry: \(error.localizedDescription)") }
            return
        }
        guard job.state == "completed" else { return }
        let related: [NativeUpload] = engine.snapshots().filter { $0.backupKey?.hasPrefix(identifier + ":") == true }
        guard let expected = job.backupResourceCount, related.count == expected, related.allSatisfy({ $0.state == "completed" }) else { return }
        state.retryAssets = (state.retryAssets ?? []).filter { $0 != identifier }
        if timestamp > (state.lastUploadedAt ?? 0) ||
            (timestamp == state.lastUploadedAt && identifier > state.lastUploadedIdentifier) {
            state.lastUploadedAt = timestamp
            state.lastUploadedIdentifier = identifier
            do { try save() } catch { logger.error("Cannot persist uploaded photo checkpoint: \(error.localizedDescription)") }
        }
    }

    /// Reschedule best-effort background processing and short refresh windows.
    func schedule() -> Void {
        guard state.enabled else { return }
        let processing: BGProcessingTaskRequest = BGProcessingTaskRequest(identifier: Self.processingIdentifier)
        processing.requiresNetworkConnectivity = true
        processing.requiresExternalPower = false
        processing.earliestBeginDate = Date().addingTimeInterval(3600)
        let refresh: BGAppRefreshTaskRequest = BGAppRefreshTaskRequest(identifier: Self.refreshIdentifier)
        refresh.earliestBeginDate = Date().addingTimeInterval(3600)
        for request: BGTaskRequest in [processing, refresh] {
            do { try BGTaskScheduler.shared.submit(request) } catch {
                logger.error("Background scheduling unavailable: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    /// React to new accessible photos while the app process is alive.
    nonisolated func photoLibraryDidChange(_ changeInstance: PHChange) -> Void {
        DispatchQueue.main.async {
            Task { do { try await self.run() } catch { self.logger.error("Photo change scan failed: \(error.localizedDescription)") } }
        }
    }
}
