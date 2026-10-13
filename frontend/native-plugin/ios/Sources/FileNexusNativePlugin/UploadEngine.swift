import Foundation
import UserNotifications
import os

/// Persisted TUS job, including the acknowledged offset and original file.
struct NativeUpload: Codable {
    var jobId: String
    var name: String
    var mimeType: String
    var folderId: String?
    var source: String
    var state: String = "queued"
    var bytesSent: Int64 = 0
    var bytesTotal: Int64
    var error: String?
    var createdAt: Double = Date().timeIntervalSince1970 * 1000
    var updatedAt: Double = Date().timeIntervalSince1970 * 1000
    var file: URL
    var uploadURL: URL?
    var relativePath: String?
    var lastModified: Double?
    var attempts: Int = 0
    var retryAt: Date?
    var taskIdentifier: Int?
    var chunkFile: URL?
    var patchEnd: Int64?
    var credentialId: String?
    var backupKey: String?
    var backupResourceCount: Int?

    /// Expose only the public queue snapshot, never credentials or private paths.
    func json() -> [String: Any] {
        return ["jobId": jobId, "name": name, "mimeType": mimeType,
                "folderId": folderId as Any? ?? NSNull(), "source": source, "state": state,
                "bytesSent": bytesSent, "bytesTotal": bytesTotal, "error": error as Any? ?? NSNull(),
                "createdAt": createdAt, "updatedAt": updatedAt]
    }
}

/// File-backed TUS transfers with durable state and a reconnectable background session.
@MainActor
final class UploadEngine: NSObject, URLSessionTaskDelegate, URLSessionDelegate {
    static let chunkSize: Int64 = 8 * 1024 * 1024
    let directory: URL
    let sessionIdentifier: String
    let groupIdentifier: String?
    let background: Bool
    private let queueFile: URL
    private let sessionOverride: URLSessionConfiguration?
    private var jobs: [NativeUpload]
    private var reconnecting: Bool = true
    private var stopped: Bool = false
    private var retryTimer: Timer?
    private let logger: Logger = Logger(subsystem: "cc.spkuan.filenexus", category: "Upload")
    var onProgress: ((NativeUpload) -> Void)?
    /// Inject notification delivery for a hostless XCTest process without an app bundle.
    var notificationSink: ((NativeUpload) -> Void)?
    var backgroundCompletion: (() -> Void)?
    var configurationProvider: () throws -> NativeConfiguration = { return try NativeStorage.configuration() }

    private lazy var session: URLSession = {
        let configuration: URLSessionConfiguration = sessionOverride ?? (background
            ? URLSessionConfiguration.background(withIdentifier: sessionIdentifier)
            : URLSessionConfiguration.default)
        configuration.sharedContainerIdentifier = groupIdentifier
        configuration.sessionSendsLaunchEvents = background
        configuration.isDiscretionary = false
        configuration.timeoutIntervalForRequest = 120
        configuration.timeoutIntervalForResource = 7 * 24 * 3600
        return URLSession(configuration: configuration, delegate: self, delegateQueue: OperationQueue.main)
    }()

    /// Restore a queue from disk; use independent identifiers for app and extension.
    init(directory: URL, identifier: String, groupIdentifier: String? = nil, background: Bool = true, sessionConfiguration: URLSessionConfiguration? = nil) throws {
        self.directory = directory
        self.queueFile = directory.appendingPathComponent("uploads.json")
        self.jobs = try NativeStorage.read([NativeUpload].self, from: self.queueFile) ?? []
        self.sessionIdentifier = identifier
        self.groupIdentifier = groupIdentifier
        self.background = background
        self.sessionOverride = sessionConfiguration
        super.init()
        session.getAllTasks { tasks in
            DispatchQueue.main.async {
                let identifiers: Set<Int> = Set(tasks.map { $0.taskIdentifier })
                for index: Int in self.jobs.indices where self.jobs[index].taskIdentifier != nil {
                    if let identifier = self.jobs[index].taskIdentifier, !identifiers.contains(identifier) {
                        self.jobs[index].taskIdentifier = nil
                        if self.jobs[index].state == "uploading" { self.jobs[index].state = "queued" }
                    }
                }
                self.reconnecting = false
                do { try self.persist(); self.pump() } catch { self.persistenceFailure(error) }
            }
        }
    }

    /// Return the queue, newest first.
    func snapshots() -> [NativeUpload] { return jobs.sorted { $0.createdAt > $1.createdAt } }

    /// Copy a file before committing its job, so provider access may safely expire.
    func enqueue(file: URL, name: String, mimeType: String, folderId: String?, source: String,
                 relativePath: String? = nil, lastModified: Double? = nil, wifiOnly: Bool = false, backupKey: String? = nil, backupResourceCount: Int? = nil) throws -> String {
        if let key = backupKey, let existing = jobs.first(where: { $0.backupKey == key && $0.state != "cancelled" }) {
            return existing.jobId
        }
        let configuration: NativeConfiguration = try configurationProvider()
        _ = try configuration.credentials()
        guard !name.isEmpty, !name.contains("/"), !name.contains("\\"), name != ".", name != ".." else {
            throw NativeFailure("Upload filename must be a single nonempty path component", code: "INVALID_ARGUMENT")
        }
        let copied: URL = try NativeStorage.copy(file, to: directory)
        let attributes: [FileAttributeKey: Any] = try FileManager.default.attributesOfItem(atPath: copied.path)
        guard let size = attributes[.size] as? NSNumber else { throw NativeFailure("Cannot determine upload file size") }
        var job: NativeUpload = NativeUpload(jobId: UUID().uuidString, name: name, mimeType: mimeType,
            folderId: folderId, source: source, bytesTotal: size.int64Value, file: copied,
            relativePath: relativePath, lastModified: lastModified, credentialId: try configuration.fingerprint(), backupKey: backupKey, backupResourceCount: backupResourceCount)
        // Constraint is retained in metadata-free state alongside the queue.
        if wifiOnly { job.source = "backup" }
        jobs.append(job)
        do { try persist() } catch { jobs.removeLast(); try FileManager.default.removeItem(at: copied); throw error }
        onProgress?(job)
        pump()
        return job.jobId
    }

    /// Resume queued work after configuration changes or a lifecycle wakeup.
    func resume() -> Void { pump() }

    /// Pause submitted tasks on logout; cancelled requests are reconciled by HEAD later.
    func configurationChanged() throws -> Void {
        let configuration: NativeConfiguration = try configurationProvider()
        let previousTasks: Set<Int> = Set(jobs.compactMap { $0.taskIdentifier })
        session.getAllTasks { tasks in tasks.filter { previousTasks.contains($0.taskIdentifier) }.forEach { $0.cancel() } }
        for index: Int in jobs.indices where ["uploading", "queued", "retrying"].contains(jobs[index].state) {
            jobs[index].taskIdentifier = nil
            jobs[index].state = "queued"
            // Never resume a capability created under another account/device.
            if configuration.deviceToken != nil, try configuration.fingerprint() != jobs[index].credentialId {
                jobs[index].uploadURL = nil
                jobs[index].bytesSent = 0
                jobs[index].credentialId = try configuration.fingerprint()
            }
        }
        try persist()
        pump()
    }

    /// Terminate a job locally and on its TUS endpoint when one exists.
    func cancel(_ jobId: String) async throws -> Void {
        guard let index = jobs.firstIndex(where: { $0.jobId == jobId }) else {
            throw NativeFailure("Upload job does not exist", code: "JOB_NOT_FOUND")
        }
        let job: NativeUpload = jobs[index]
        jobs[index].state = "cancelled"
        jobs[index].error = nil
        jobs[index].updatedAt = Date().timeIntervalSince1970 * 1000
        jobs[index].taskIdentifier = nil
        try persist()
        session.getAllTasks { tasks in
            tasks.filter { $0.taskDescription?.hasPrefix(jobId + "|") == true }.forEach { $0.cancel() }
        }
        onProgress?(jobs[index])
        try removeFiles(job)
        defer { pump() }
        if let url = job.uploadURL {
            let configuration: NativeConfiguration = try configurationProvider()
            guard try configuration.fingerprint() == job.credentialId else {
                throw NativeFailure("Upload cancelled locally; original credentials are needed for server termination", code: "NOT_CONFIGURED")
            }
            let credentials: (URL, String) = try configuration.credentials()
            var request: URLRequest = request(url, method: "DELETE", token: credentials.1)
            request.timeoutInterval = 30
            let (_, response): (Data, URLResponse) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, [204, 404, 410].contains(http.statusCode) else {
                throw NativeFailure("Upload cancelled locally; server termination failed")
            }
        }
    }

    /// Retry retained failed backup originals during a manual scan.
    func retryFailedBackup(folderId: String) throws -> Void {
        for index: Int in jobs.indices where jobs[index].source == "backup" && ["queued", "retrying", "failed"].contains(jobs[index].state) {
            if jobs[index].folderId != folderId {
                jobs[index].folderId = folderId
                jobs[index].uploadURL = nil
                jobs[index].bytesSent = 0
            }
        }
        for index: Int in jobs.indices where jobs[index].source == "backup" && jobs[index].state == "failed" {
            jobs[index].state = "queued"
            jobs[index].attempts = 0
            jobs[index].retryAt = nil
        }
        try persist()
        pump()
    }

    /// Delete finished records and their retained originals/chunks.
    func clearFinished() throws -> Void {
        let finished: [NativeUpload] = jobs.filter { ["completed", "failed", "cancelled"].contains($0.state) }
        for job: NativeUpload in finished { try removeFiles(job) }
        jobs.removeAll { ["completed", "failed", "cancelled"].contains($0.state) }
        try persist()
    }

    /// Stop extension foreground work when its UI is dismissed.
    func stop(cancelPending: Bool = false) -> Void {
        stopped = true
        retryTimer?.invalidate()
        for index: Int in jobs.indices where ["queued", "retrying", "uploading"].contains(jobs[index].state) {
            jobs[index].taskIdentifier = nil
            jobs[index].state = cancelPending ? "cancelled" : "queued"
            jobs[index].updatedAt = Date().timeIntervalSince1970 * 1000
            if cancelPending {
                do { try removeFiles(jobs[index]) } catch { logger.error("Cannot clean cancelled share files: \(error.localizedDescription)") }
            }
        }
        do { try persist() } catch { logger.error("Cannot persist stopped share queue: \(error.localizedDescription)") }
        session.invalidateAndCancel()
    }

    private func request(_ url: URL, method: String, token: String) -> URLRequest {
        var request: URLRequest = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("1.0.0", forHTTPHeaderField: "Tus-Resumable")
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        return request
    }

    private func persist() throws -> Void { try NativeStorage.write(jobs, to: queueFile) }

    private func removeFiles(_ job: NativeUpload) throws -> Void {
        for url: URL in [job.file, job.chunkFile].compactMap({ $0 }) {
            if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        }
    }

    private func pump() -> Void {
        guard !stopped, !reconnecting, !jobs.contains(where: { $0.taskIdentifier != nil }) else { return }
        retryTimer?.invalidate()
        do {
            let configuration: NativeConfiguration = try configurationProvider()
            guard configuration.deviceToken != nil else { return }
            let credentials: (URL, String) = try configuration.credentials()
            let now: Date = Date()
            guard let index = jobs.firstIndex(where: {
                ["queued", "retrying"].contains($0.state) && ($0.retryAt == nil || ($0.retryAt ?? now) <= now)
            }) ?? (background ? jobs.firstIndex(where: { $0.state == "retrying" }) : nil) else {
                if let next = jobs.filter({ $0.state == "retrying" }).compactMap({ $0.retryAt }).min() {
                    retryTimer = Timer.scheduledTimer(withTimeInterval: max(1, next.timeIntervalSinceNow), repeats: false) { _ in self.pump() }
                }
                return
            }
            do {
                let fingerprint: String = try configuration.fingerprint()
                if jobs[index].credentialId != fingerprint {
                    jobs[index].uploadURL = nil
                    jobs[index].bytesSent = 0
                    jobs[index].credentialId = fingerprint
                    try persist()
                }
                if let url = jobs[index].uploadURL {
                    try submit(index, stage: "head", request: request(url, method: "HEAD", token: credentials.1))
                } else {
                    var create: URLRequest = request(credentials.0.appendingPathComponent("api/upload/tus"), method: "POST", token: credentials.1)
                    create.setValue(String(jobs[index].bytesTotal), forHTTPHeaderField: "Upload-Length")
                    var metadata: [String: String] = ["filename": jobs[index].name, "filetype": jobs[index].mimeType, "token": credentials.1]
                    metadata["folder_id"] = jobs[index].folderId
                    metadata["relativePath"] = jobs[index].relativePath
                    if let modified = jobs[index].lastModified { metadata["lastModified"] = String(Int64(modified)) }
                    create.setValue(TUSProtocol.metadata(metadata), forHTTPHeaderField: "Upload-Metadata")
                    try submit(index, stage: "create", request: create)
                }
            } catch { fail(index, error: error) }
        } catch {
            logger.error("Cannot start upload queue: \(error.localizedDescription, privacy: .public)")
            for index: Int in jobs.indices where ["queued", "retrying"].contains(jobs[index].state) {
                fail(index, error: error)
            }
        }
    }

    private func submit(_ index: Int, stage: String, request: URLRequest, file: URL? = nil) throws -> Void {
        let body: URL
        if let file = file { body = file } else {
            body = directory.appendingPathComponent("empty-body")
            if !FileManager.default.fileExists(atPath: body.path) {
                try Data().write(to: body, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            }
        }
        let task: URLSessionUploadTask = session.uploadTask(with: request, fromFile: body)
        task.taskDescription = jobs[index].jobId + "|" + stage
        if jobs[index].source == "backup" {
            task.countOfBytesClientExpectsToSend = jobs[index].bytesTotal
            task.countOfBytesClientExpectsToReceive = 1024
            task.earliestBeginDate = jobs[index].retryAt
            task.priority = URLSessionTask.lowPriority
            // The backup runner persists this user choice in the app-local defaults.
            if UserDefaults.standard.bool(forKey: "backup.wifiOnly") {
                task.cancel()
                var constrained: URLRequest = request
                constrained.allowsCellularAccess = false
                constrained.allowsExpensiveNetworkAccess = false
                constrained.allowsConstrainedNetworkAccess = false
                try submitConstrained(index, stage: stage, request: constrained, body: body)
                return
            }
        }
        try activate(task, index: index)
    }

    private func submitConstrained(_ index: Int, stage: String, request: URLRequest, body: URL) throws -> Void {
        let task: URLSessionUploadTask = session.uploadTask(with: request, fromFile: body)
        task.taskDescription = jobs[index].jobId + "|" + stage
        try activate(task, index: index)
    }

    private func activate(_ task: URLSessionUploadTask, index: Int) throws -> Void {
        if let retryAt = jobs[index].retryAt { task.earliestBeginDate = retryAt }
        jobs[index].state = "uploading"
        jobs[index].error = nil
        jobs[index].taskIdentifier = task.taskIdentifier
        jobs[index].updatedAt = Date().timeIntervalSince1970 * 1000
        do { try persist() } catch { task.cancel(); jobs[index].taskIdentifier = nil; throw error }
        onProgress?(jobs[index])
        task.resume()
    }

    private func patch(_ index: Int) throws -> Void {
        let job: NativeUpload = jobs[index]
        guard let url = job.uploadURL else { throw NativeFailure("Cannot PATCH without an upload URL") }
        let input: FileHandle = try FileHandle(forReadingFrom: job.file)
        defer { do { try input.close() } catch { logger.error("Cannot close upload original: \(error.localizedDescription)") } }
        try input.seek(toOffset: UInt64(job.bytesSent))
        let length: Int = Int(min(Self.chunkSize, job.bytesTotal - job.bytesSent))
        let data: Data = length == 0 ? Data() : (try input.read(upToCount: length) ?? Data())
        guard data.count == length else {
            throw NativeFailure("Upload original is truncated or unreadable")
        }
        let chunk: URL = directory.appendingPathComponent(job.jobId + "-patch")
        try data.write(to: chunk, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        jobs[index].chunkFile = chunk
        jobs[index].patchEnd = job.bytesSent + Int64(data.count)
        let credentials: (URL, String) = try configurationProvider().credentials()
        var request: URLRequest = request(url, method: "PATCH", token: credentials.1)
        request.setValue("application/offset+octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue(String(data.count), forHTTPHeaderField: "Content-Length")
        request.setValue(String(job.bytesSent), forHTTPHeaderField: "Upload-Offset")
        try submit(index, stage: "patch", request: request, file: chunk)
    }

    private func fail(_ index: Int, error: Error) -> Void {
        jobs[index].taskIdentifier = nil
        jobs[index].attempts += 1
        let retry: Bool = (error as? NativeFailure)?.retryable ?? true
        jobs[index].state = retry && jobs[index].attempts < 10 ? "retrying" : "failed"
        jobs[index].error = error.localizedDescription
        jobs[index].updatedAt = Date().timeIntervalSince1970 * 1000
        jobs[index].retryAt = Date().addingTimeInterval(min(3600, 30 * pow(2, Double(jobs[index].attempts - 1))))
        logger.error("Upload \(self.jobs[index].jobId, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
        do { try persist() } catch { persistenceFailure(error); return }
        onProgress?(jobs[index])
        if jobs[index].state == "failed" { notify(jobs[index]) }
        pump()
    }

    private func persistenceFailure(_ error: Error) -> Void {
        logger.fault("Upload persistence failed: \(error.localizedDescription, privacy: .public)")
        session.getAllTasks { tasks in tasks.forEach { $0.cancel() } }
        for index: Int in jobs.indices where ["uploading", "queued", "retrying"].contains(jobs[index].state) {
            jobs[index].state = "failed"
            jobs[index].error = "Upload persistence failed: " + error.localizedDescription
            onProgress?(jobs[index])
        }
    }

    private func notify(_ job: NativeUpload) -> Void {
        if let sink = notificationSink { sink(job); return }
        let content: UNMutableNotificationContent = UNMutableNotificationContent()
        content.title = job.state == "completed" ? "上傳完成" : "上傳失敗"
        content.body = job.name
        let request: UNNotificationRequest = UNNotificationRequest(identifier: job.jobId, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error { self.logger.error("Cannot post upload notification: \(error.localizedDescription)") }
        }
    }

    /// Validate server acknowledgements before advancing persisted offsets.
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) -> Void {
        DispatchQueue.main.async { self.complete(task, error: error) }
    }

    private func complete(_ task: URLSessionTask, error: Error?) -> Void {
        guard !stopped else { return }
        guard let description = task.taskDescription else { return }
        let parts: [Substring] = description.split(separator: "|")
        guard parts.count == 2, let index = jobs.firstIndex(where: { $0.jobId == String(parts[0]) }),
              jobs[index].taskIdentifier == task.taskIdentifier, jobs[index].state != "cancelled" else { return }
        jobs[index].taskIdentifier = nil
        do {
            let configuration: NativeConfiguration = try configurationProvider()
            if configuration.deviceToken == nil {
                jobs[index].state = "queued"
                try persist()
                return
            }
            let fingerprint: String = try configuration.fingerprint()
            if jobs[index].credentialId != fingerprint {
                jobs[index].uploadURL = nil
                jobs[index].bytesSent = 0
                jobs[index].credentialId = fingerprint
                jobs[index].state = "queued"
                try persist(); pump(); return
            }
            if let error = error { fail(index, error: error); return }
            guard let response = task.response as? HTTPURLResponse else { throw NativeFailure("TUS returned no HTTP response", retryable: true) }
            let status: Int = response.statusCode
            let stage: String = String(parts[1])
            if stage == "head", [404, 410].contains(status) {
                jobs[index].uploadURL = nil
                jobs[index].bytesSent = 0
                jobs[index].state = "queued"
                try persist(); pump(); return
            }
            guard TUSProtocol.accepts(status, stage: stage) else { throw NativeFailure("TUS \(stage) failed (HTTP \(status))", retryable: TUSProtocol.retryable(status)) }
            if stage == "create" {
                let credentials: (URL, String) = try configurationProvider().credentials()
                jobs[index].uploadURL = try TUSProtocol.location(response.value(forHTTPHeaderField: "Location"), origin: credentials.0)
                jobs[index].state = "queued"
                try persist(); pump(); return
            }
            let offset: Int64 = try TUSProtocol.offset(response.value(forHTTPHeaderField: "Upload-Offset"), total: jobs[index].bytesTotal)
            if stage == "patch", offset != jobs[index].patchEnd {
                throw NativeFailure("TUS PATCH acknowledgement did not match transmitted bytes", retryable: true)
            }
            jobs[index].bytesSent = offset
            jobs[index].updatedAt = Date().timeIntervalSince1970 * 1000
            jobs[index].attempts = 0
            jobs[index].retryAt = nil
            if TUSProtocol.completed(stage: stage, offset: offset, total: jobs[index].bytesTotal) {
                jobs[index].state = "completed"
                try persist()
                onProgress?(jobs[index]); notify(jobs[index])
                do { try removeFiles(jobs[index]) } catch {
                    logger.error("Upload completed, but local cleanup failed: \(error.localizedDescription, privacy: .public)")
                }
                pump()
            } else {
                try persist()
                onProgress?(jobs[index])
                try patch(index)
            }
        } catch { fail(index, error: error) }
    }

    /// Forward the system's completion callback only after all delegate events drain.
    nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) -> Void {
        DispatchQueue.main.async {
            let completion: (() -> Void)? = self.backgroundCompletion
            self.backgroundCompletion = nil
            completion?()
        }
    }

    /// Refuse HTTP redirects so a device token never leaks to a different host.
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) -> Void {
        completionHandler(nil)
    }
}
