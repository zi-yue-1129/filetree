import UIKit
import UniformTypeIdentifiers
import Foundation
import os

/// FileNexus share sheet with independent login and visible fallback upload progress.
final class ShareViewController: UIViewController {
    private let logger: Logger = Logger(subsystem: "cc.spkuan.filenexus", category: "Share")
    private let statusLabel: UILabel = UILabel()
    private let serverField: UITextField = UITextField()
    private let passwordField: UITextField = UITextField()
    private let progress: UIProgressView = UIProgressView(progressViewStyle: .default)
    private let uploadButton: UIButton = UIButton(type: .system)
    private let finishButton: UIButton = UIButton(type: .system)
    private var engine: UploadEngine?
    private var group: (String, URL)?
    private var files: [(URL, String, String)] = []
    private var jobIds: [String] = []
    private var worker: Task<Void, Never>?
    private var loaded: Bool = false
    private var started: Bool = false

    /// Build a compact, accessible share UI that remains visible during foreground uploads.
    override func viewDidLoad() -> Void {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        statusLabel.numberOfLines = 0
        statusLabel.text = "正在準備分享項目…"
        serverField.placeholder = "伺服器網址（https://…）"
        serverField.borderStyle = .roundedRect
        serverField.keyboardType = .URL
        serverField.autocapitalizationType = .none
        serverField.autocorrectionType = .no
        passwordField.placeholder = "FileNexus 登入密碼（非 Apple ID）"
        passwordField.borderStyle = .roundedRect
        passwordField.isSecureTextEntry = true
        uploadButton.setTitle("登入並上傳", for: .normal)
        uploadButton.addTarget(self, action: #selector(upload), for: .touchUpInside)
        uploadButton.isEnabled = false
        finishButton.setTitle("取消", for: .normal)
        finishButton.addTarget(self, action: #selector(finish), for: .touchUpInside)
        let title: UILabel = UILabel()
        title.text = "分享到 FileNexus"
        title.font = .preferredFont(forTextStyle: .title2)
        let stack: UIStackView = UIStackView(arrangedSubviews: [title, statusLabel, serverField, passwordField, progress, uploadButton, finishButton])
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24)
        ])
    }

    /// Materialize provider files before their temporary access expires.
    override func viewDidAppear(_ animated: Bool) -> Void {
        super.viewDidAppear(animated)
        guard !loaded else { return }
        loaded = true
        worker = Task { @MainActor in
            do {
                group = try NativeStorage.appGroup()
                let identifier: String = (Bundle.main.bundleIdentifier ?? "cc.spkuan.filenexus.share") + ".uploads"
                let directory: URL = try NativeStorage.directory("extension-uploads", shared: group != nil)
                let uploader: UploadEngine = try UploadEngine(directory: directory, identifier: identifier,
                    groupIdentifier: group?.0, background: group != nil)
                if let group = group {
                    uploader.configurationProvider = {
                        guard let configuration = try NativeStorage.read(NativeConfiguration.self,
                                from: group.1.appendingPathComponent("configuration.json")) else {
                            return try NativeStorage.configuration()
                        }
                        return configuration
                    }
                }
                engine = uploader
                uploader.onProgress = { [weak self] job in self?.updateProgress(job) }
                let configuration: NativeConfiguration = try uploader.configurationProvider()
                serverField.text = configuration.serverUrl ?? Bundle.main.object(forInfoDictionaryKey: "FileNexusServerURL") as? String
                let items: [NSExtensionItem] = extensionContext?.inputItems as? [NSExtensionItem] ?? []
                for item: NSExtensionItem in items {
                    for provider: NSItemProvider in item.attachments ?? [] {
                        try Task.checkCancellation()
                        files.append(try await receive(provider, directory: directory))
                    }
                }
                guard !files.isEmpty else { throw NativeFailure("No supported files, images, videos or URLs were shared") }
                statusLabel.text = group == nil
                    ? "共 \(files.count) 個項目。免費簽署模式需在此獨立登入；上傳時請保持此畫面開啟。"
                    : "共 \(files.count) 個項目。已啟用共享容器，可使用背景上傳。"
                uploadButton.isEnabled = true
                if group != nil { finishButton.setTitle("稍後在主程式上傳", for: .normal) }
                if configuration.deviceToken != nil {
                    serverField.isHidden = true
                    passwordField.isHidden = true
                    try startUploads()
                }
            } catch { showError(error) }
        }
    }

    private func receive(_ provider: NSItemProvider, directory: URL) async throws -> (URL, String, String) {
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            return try await withCheckedThrowingContinuation { continuation in
                provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, error in
                    do {
                        if let error = error { throw error }
                        guard let url = item as? URL else { throw NativeFailure("Shared file has no readable URL") }
                        let copied: URL = try NativeStorage.copy(url, to: directory)
                        let mime: String = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                        continuation.resume(returning: (copied, url.lastPathComponent, mime))
                    } catch { continuation.resume(throwing: error) }
                }
            }
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) || provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            let type: String = provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) ? UTType.url.identifier : UTType.plainText.identifier
            return try await withCheckedThrowingContinuation { continuation in
                provider.loadItem(forTypeIdentifier: type, options: nil) { item, error in
                    do {
                        if let error = error { throw error }
                        let text: String
                        if let url = item as? URL { text = url.absoluteString }
                        else if let value = item as? String { text = value }
                        else { throw NativeFailure("Shared URL/text is unreadable") }
                        let file: URL = directory.appendingPathComponent(UUID().uuidString + ".txt")
                        try Data(text.utf8).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                        continuation.resume(returning: (file, "分享連結.txt", "text/plain"))
                    } catch { continuation.resume(throwing: error) }
                }
            }
        }
        guard let type = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .data) == true }) else {
            throw NativeFailure("This shared item type is unsupported")
        }
        return try await withCheckedThrowingContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
                do {
                    if let error = error { throw error }
                    guard let url = url else { throw NativeFailure("Shared media could not be exported") }
                    // Copy inside the callback: the provider deletes its URL on return.
                    let copied: URL = try NativeStorage.copy(url, to: directory)
                    continuation.resume(returning: (copied, url.lastPathComponent,
                        UTType(type)?.preferredMIMEType ?? "application/octet-stream"))
                } catch { continuation.resume(throwing: error) }
            }
        }
    }

    @objc private func upload() -> Void {
        guard !started else { return }
        uploadButton.isEnabled = false
        worker = Task { @MainActor in
            do {
                guard let server = serverField.text, let origin = URL(string: server), origin.scheme == "https",
                      origin.host != nil, origin.user == nil, origin.password == nil, origin.query == nil,
                      origin.fragment == nil, origin.path.isEmpty || origin.path == "/",
                      let password = passwordField.text, !password.isEmpty else {
                    throw NativeFailure("Enter an HTTPS server origin and your FileNexus password")
                }
                var request: URLRequest = URLRequest(url: origin.appendingPathComponent("api/devices/register"))
                request.httpMethod = "POST"
                request.timeoutInterval = 30
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: ["password": password,
                    "device_name": "iPhone 分享", "platform": "ios"])
                let (data, response): (Data, URLResponse) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                      let result = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let token = result["device_token"] as? String, let id = result["device_id"] as? String else {
                    throw NativeFailure("Share login failed; check the server and FileNexus password")
                }
                try NativeStorage.configure(NativeConfiguration(serverUrl: server, deviceToken: token,
                    deviceId: id, deviceName: "iPhone 分享"), mirror: true)
                // Independent login remains extension-local even if an optional group exists.
                engine?.configurationProvider = { return try NativeStorage.configuration() }
                passwordField.text = nil
                passwordField.isHidden = true
                serverField.isHidden = true
                try startUploads()
            } catch { showError(error); uploadButton.isEnabled = true }
        }
    }

    private func startUploads() throws -> Void {
        guard let engine = engine else { throw NativeFailure("Share uploader is unavailable") }
        started = true
        uploadButton.isHidden = true
        for (url, name, mime): (URL, String, String) in files {
            jobIds.append(try engine.enqueue(file: url, name: name, mimeType: mime, folderId: nil, source: "share"))
            try FileManager.default.removeItem(at: url)
        }
        finishButton.setTitle(group == nil ? "取消上傳" : "關閉（背景繼續上傳）", for: .normal)
        statusLabel.text = group == nil ? "上傳中，請保持此畫面開啟。" : "上傳已排入背景佇列，可關閉此畫面。"
    }

    private func updateProgress(_ job: NativeUpload) -> Void {
        guard jobIds.contains(job.jobId), let engine = engine else { return }
        let jobs: [NativeUpload] = engine.snapshots().filter { jobIds.contains($0.jobId) }
        let total: Int64 = jobs.reduce(0) { $0 + $1.bytesTotal }
        let sent: Int64 = jobs.reduce(0) { $0 + $1.bytesSent }
        progress.progress = total > 0 ? Float(sent) / Float(total) : 0
        let completed: Int = jobs.filter { $0.state == "completed" }.count
        statusLabel.text = "已完成 \(completed)/\(jobIds.count)，\(sent)/\(total) 位元組。" + (group == nil ? "請保持此畫面開啟。" : "可於背景繼續。")
        if let failed = jobs.first(where: { $0.state == "failed" }) {
            statusLabel.text = "上傳失敗：" + (failed.error ?? "Unknown upload error")
            finishButton.setTitle("關閉", for: .normal)
        } else if completed == jobIds.count {
            statusLabel.text = "全部上傳完成。"
            finishButton.setTitle("完成", for: .normal)
        }
    }

    private func showError(_ error: Error) -> Void {
        logger.error("Share failed: \(error.localizedDescription, privacy: .public)")
        statusLabel.text = "無法分享：" + error.localizedDescription
    }

    @objc private func finish() -> Void {
        if !started, group != nil, !files.isEmpty {
            do {
                let inbox: URL = try NativeStorage.directory("share-inbox", shared: true)
                for (file, name, mime): (URL, String, String) in files {
                    let id: String = UUID().uuidString
                    let copied: URL = try NativeStorage.copy(file, to: inbox)
                    let item: [String: Any] = ["id": id, "uri": copied.absoluteString, "name": name,
                        "mimeType": mime, "receivedAt": Date().timeIntervalSince1970 * 1000]
                    try JSONSerialization.data(withJSONObject: item).write(to: inbox.appendingPathComponent(id + ".json"),
                        options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                    try FileManager.default.removeItem(at: file)
                }
            } catch { showError(error); return }
        }
        worker?.cancel()
        if group == nil { engine?.stop() }
        extensionContext?.completeRequest(returningItems: nil)
    }
}
