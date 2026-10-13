import XCTest
import Foundation

/// A deterministic local transport exercising real URLSession delegate transitions.
final class TUSFixture: URLProtocol {
    private static let lock: NSLock = NSLock()
    private static var requests: [URLRequest] = []
    private static var total: Int64 = 0
    private static var creationStatus: Int = 201
    private static var patchStatus: Int = 204

    /// Reset the scripted backend before each independent engine test.
    static func reset(total: Int64, creationStatus: Int = 201, patchStatus: Int = 204) -> Void {
        lock.lock()
        defer { lock.unlock() }
        Self.requests = []
        Self.total = total
        Self.creationStatus = creationStatus
        Self.patchStatus = patchStatus
    }

    /// Read recorded requests under the same transport lock.
    static func recorded() -> [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return requests
    }

    /// Intercept only fixture servers; any unexpected host fails instead of using network.
    override class func canInit(with request: URLRequest) -> Bool { return true }

    /// Preserve the request for assertions.
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { return request }

    /// Produce the same creation/resume/finalization responses as the FileNexus backend.
    override func startLoading() -> Void {
        Self.lock.lock()
        Self.requests.append(request)
        let total: Int64 = Self.total
        let create: Int = Self.creationStatus
        let patch: Int = Self.patchStatus
        Self.lock.unlock()
        guard request.url?.host == "fixture.example" || request.url?.host == "new.example" else {
            client?.urlProtocol(self, didFailWithError: NativeFailure("Credentials were sent to an unexpected host"))
            return
        }
        let status: Int
        var headers: [String: String] = ["Tus-Resumable": "1.0.0"]
        switch request.httpMethod {
        case "POST":
            status = create
            headers["Location"] = "http://internal-backend:5168/api/upload/tus/fixture"
        case "HEAD":
            status = 200
            headers["Upload-Offset"] = "0"
        case "PATCH":
            status = patch
            headers["Upload-Offset"] = String(total)
        default:
            client?.urlProtocol(self, didFailWithError: NativeFailure("Unexpected TUS request method"))
            return
        }
        guard let url = request.url, let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            client?.urlProtocol(self, didFailWithError: NativeFailure("Cannot construct fixture response"))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data())
        client?.urlProtocolDidFinishLoading(self)
    }

    /// URLProtocol has no outstanding asynchronous transport to cancel.
    override func stopLoading() -> Void {}
}

/// State-machine regressions against the production upload engine on an iOS simulator.
final class UploadEngineTests: XCTestCase {
    private func configuration(server: String = "https://fixture.example", token: String = "fixture-token") -> NativeConfiguration {
        return NativeConfiguration(serverUrl: server, deviceToken: token, deviceId: nil, deviceName: "Fixture")
    }

    @MainActor private func engine(directory: URL) throws -> UploadEngine {
        let session: URLSessionConfiguration = URLSessionConfiguration.ephemeral
        session.protocolClasses = [TUSFixture.self]
        let engine: UploadEngine = try UploadEngine(directory: directory, identifier: UUID().uuidString,
                                                   background: false, sessionConfiguration: session)
        engine.configurationProvider = { return self.configuration() }
        return engine
    }

    private func directory() throws -> URL {
        let directory: URL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    @MainActor private func transfer(data: Data, creationStatus: Int) async throws -> ([URLRequest], NativeUpload) {
        TUSFixture.reset(total: Int64(data.count), creationStatus: creationStatus)
        let directory: URL = try directory()
        let file: URL = directory.appendingPathComponent("fixture.txt")
        try data.write(to: file)
        let uploader: UploadEngine = try engine(directory: directory)
        let completed: XCTestExpectation = expectation(description: "Server finalization")
        uploader.onProgress = { job in
            if job.state == "completed" { completed.fulfill() }
            if job.state == "failed" { XCTFail(job.error ?? "Upload failed"); completed.fulfill() }
        }
        _ = try uploader.enqueue(file: file, name: "測試.txt", mimeType: "text/plain", folderId: "folder", source: "app", relativePath: "旅行/測試.txt")
        await fulfillment(of: [completed], timeout: 10)
        guard let job = uploader.snapshots().first else { throw NativeFailure("Missing persisted upload") }
        let stored: [NativeUpload]? = try NativeStorage.read([NativeUpload].self, from: directory.appendingPathComponent("uploads.json"))
        XCTAssertEqual(stored?.first?.state, "completed")
        XCTAssertEqual(job.bytesSent, Int64(data.count))
        uploader.stop()
        return (TUSFixture.recorded(), job)
    }

    /// Normal uploads preserve metadata and follow POST/HEAD/PATCH through proxy rewriting.
    @MainActor func testOriginalFileUpload() async throws -> Void {
        let (requests, job): ([URLRequest], NativeUpload) = try await transfer(data: Data("abc".utf8), creationStatus: 201)
        XCTAssertEqual(requests.map { $0.httpMethod ?? "" }, ["POST", "HEAD", "PATCH"])
        XCTAssertTrue(requests.allSatisfy { $0.url?.host == "fixture.example" })
        XCTAssertEqual(job.state, "completed")
        XCTAssertTrue(requests.first?.value(forHTTPHeaderField: "Upload-Metadata")?.contains("folder_id") == true)
    }

    /// A lost creation response can recover an existing backend fingerprint with HTTP 200.
    @MainActor func testExistingFingerprintCreation() async throws -> Void {
        let (_, job): ([URLRequest], NativeUpload) = try await transfer(data: Data("abc".utf8), creationStatus: 200)
        XCTAssertEqual(job.state, "completed")
    }

    /// Zero-byte files still send PATCH so the backend imports the file.
    @MainActor func testEmptyFileFinalization() async throws -> Void {
        let (requests, job): ([URLRequest], NativeUpload) = try await transfer(data: Data(), creationStatus: 201)
        XCTAssertEqual(requests.last?.httpMethod, "PATCH")
        XCTAssertEqual(job.state, "completed")
    }

    /// Restored jobs without deviceId never send new credentials to a previous origin.
    @MainActor func testCredentialOriginChangeOnRestore() async throws -> Void {
        TUSFixture.reset(total: 3)
        let directory: URL = try directory()
        let file: URL = directory.appendingPathComponent("retained.txt")
        try Data("abc".utf8).write(to: file)
        let old: NativeConfiguration = configuration(server: "https://old.example", token: "old-token")
        var job: NativeUpload = NativeUpload(jobId: UUID().uuidString, name: "retained.txt", mimeType: "text/plain", source: "app", bytesTotal: 3, file: file)
        job.uploadURL = URL(string: "https://old.example/api/upload/tus/old")
        job.credentialId = try old.fingerprint()
        try NativeStorage.write([job], to: directory.appendingPathComponent("uploads.json"))
        let uploader: UploadEngine = try engine(directory: directory)
        uploader.configurationProvider = { return self.configuration(server: "https://new.example", token: "new-token") }
        let completed: XCTestExpectation = expectation(description: "New origin upload")
        uploader.onProgress = { job in if ["completed", "failed"].contains(job.state) { completed.fulfill() } }
        await fulfillment(of: [completed], timeout: 10)
        XCTAssertEqual(uploader.snapshots().first?.state, "completed")
        XCTAssertEqual(TUSFixture.recorded().first?.httpMethod, "POST")
        XCTAssertTrue(TUSFixture.recorded().allSatisfy { $0.url?.host == "new.example" })
        uploader.stop()
    }

    /// Dismissal cannot pump another task on an invalidated extension session.
    @MainActor func testStoppedQueueRemainsPaused() async throws -> Void {
        TUSFixture.reset(total: 3)
        let directory: URL = try directory()
        let file: URL = directory.appendingPathComponent("fixture.txt")
        try Data("abc".utf8).write(to: file)
        let uploader: UploadEngine = try engine(directory: directory)
        _ = try uploader.enqueue(file: file, name: "fixture.txt", mimeType: "text/plain", folderId: nil, source: "share")
        uploader.stop()
        uploader.resume()
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(uploader.snapshots().first?.state, "queued")
        XCTAssertTrue(TUSFixture.recorded().isEmpty)
    }
}
