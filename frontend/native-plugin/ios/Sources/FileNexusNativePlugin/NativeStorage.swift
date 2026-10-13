import Foundation
import Security
import CryptoKit
import UniformTypeIdentifiers
import os

/// Credentials in an executable-local Keychain; never a shared access group.
struct NativeConfiguration: Codable {
    var serverUrl: String?
    var deviceToken: String?
    var deviceId: String?
    var deviceName: String?

    /// Require an HTTPS origin and an authenticated device for native work.
    func credentials() throws -> (URL, String) {
        guard let serverUrl = serverUrl, let url = URL(string: serverUrl),
              url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
              let token = deviceToken, !token.isEmpty else {
            throw NativeFailure("Configure an HTTPS server and sign in first", code: "NOT_CONFIGURED")
        }
        return (url, token)
    }

    /// Compare credential ownership without persisting the token in queue state.
    func fingerprint() throws -> String {
        let credentials: (URL, String) = try credentials()
        return SHA256.hash(data: Data((credentials.0.absoluteString + "\n" + credentials.1).utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    /// Return the exact TypeScript configuration shape.
    func json() -> [String: Any] {
        return ["serverUrl": serverUrl as Any? ?? NSNull(), "deviceToken": deviceToken as Any? ?? NSNull(),
                "deviceId": deviceId as Any? ?? NSNull(), "deviceName": deviceName as Any? ?? NSNull()]
    }
}

/// Filesystem and Keychain persistence shared as code, not as Keychain entitlements.
enum NativeStorage {
    static let logger: Logger = Logger(subsystem: "cc.spkuan.filenexus", category: "Storage")
    static let groupBase: String = "group.cc.spkuan.filenexus"

    /// Find the actual provisioned group, including SideStore's appended Team ID.
    static func appGroup() throws -> (String, URL)? {
        guard let profile = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision") else {
            return nil
        }
        let data: Data = try Data(contentsOf: profile)
        let startMarker: Data = Data("<?xml".utf8)
        let endMarker: Data = Data("</plist>".utf8)
        guard let start = data.range(of: startMarker), let end = data.range(of: endMarker),
              start.lowerBound < end.upperBound else {
            throw NativeFailure("Installed provisioning profile has no entitlement plist")
        }
        let plist: Any = try PropertyListSerialization.propertyList(
            from: data.subdata(in: start.lowerBound..<end.upperBound), options: [], format: nil)
        guard let dictionary = plist as? [String: Any], let entitlements = dictionary["Entitlements"] as? [String: Any] else {
            throw NativeFailure("Installed provisioning profile has invalid entitlements")
        }
        let groups: [String] = entitlements["com.apple.security.application-groups"] as? [String] ?? []
        for identifier: String in groups where identifier == groupBase || identifier.hasPrefix(groupBase + ".") {
            if let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier) {
                return (identifier, container)
            }
        }
        return nil
    }

    /// Create a private persistent directory, optionally inside the entitled group.
    static func directory(_ name: String, shared: Bool = false) throws -> URL {
        let base: URL
        if shared, let group = try appGroup() {
            base = group.1
        } else {
            base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                              appropriateFor: nil, create: true)
        }
        let directory: URL = base.appendingPathComponent("FileNexus/" + name, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                               attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        return directory
    }

    /// Decode persisted JSON, returning nil only when the file does not exist.
    static func read<T: Decodable>(_ type: T.Type, from url: URL) throws -> T? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(type, from: Data(contentsOf: url))
    }

    /// Atomically save protected state before scheduling a network task.
    static func write<T: Encodable>(_ value: T, to url: URL) throws -> Void {
        try JSONEncoder().encode(value).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// Read only this executable's Keychain item.
    static func configuration() throws -> NativeConfiguration {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrService as String: (Bundle.main.bundleIdentifier ?? "cc.spkuan.filenexus") + ".FileNexusConfiguration",
                                   kSecAttrAccount as String: "device", kSecReturnData as String: true]
        var result: CFTypeRef?
        let status: OSStatus = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return NativeConfiguration() }
        guard status == errSecSuccess, let data = result as? Data else {
            throw NativeFailure("Cannot read device credentials from Keychain (\(status))")
        }
        return try JSONDecoder().decode(NativeConfiguration.self, from: data)
    }

    /// Save app-local credentials and mirror into a protected group file when entitled.
    static func configure(_ configuration: NativeConfiguration, mirror: Bool = true) throws -> Void {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrService as String: (Bundle.main.bundleIdentifier ?? "cc.spkuan.filenexus") + ".FileNexusConfiguration", kSecAttrAccount as String: "device"]
        let data: Data = try JSONEncoder().encode(configuration)
        let attributes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status: OSStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw NativeFailure("Cannot store device credentials in Keychain (\(status))") }
        if mirror, let group = try appGroup() {
            try write(configuration, to: group.1.appendingPathComponent("configuration.json"))
        }
    }

    /// Copy a security-scoped document into durable storage for file upload tasks.
    static func copy(_ url: URL, to directory: URL) throws -> URL {
        let scoped: Bool = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard url.isFileURL else { throw NativeFailure("Only local file URLs can be uploaded", code: "INVALID_ARGUMENT") }
        let destination: URL = directory.appendingPathComponent(UUID().uuidString + "-" + url.lastPathComponent)
        try FileManager.default.copyItem(at: url, to: destination)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                                             ofItemAtPath: destination.path)
        return destination
    }

    /// Make a provider name safe as one server path segment (no separators, never empty, `.` or `..`).
    static func safeSegment(_ raw: String, fallback: String) -> String {
        let replaced: String = String(raw.unicodeScalars.map { scalar -> Character in
            scalar == "/" || scalar == "\\" || CharacterSet.controlCharacters.contains(scalar) ? "_" : Character(scalar)
        })
        let cleaned: String = String(replaced.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
        return cleaned.isEmpty || cleaned == "." || cleaned == ".." ? fallback : cleaned
    }

    /// Copy every regular file below a security-scoped folder into durable storage.
    ///
    /// Returns the TypeScript `PickFolderResult` shape: each file's `relativePath` is
    /// `<folder>/<sub dirs>/<name>` as the backend's `resolve_upload_folder` expects.
    /// Symlinks and other non-regular items are counted in `skippedCount`.
    static func copyFolder(_ folder: URL, to directory: URL) throws -> [String: Any] {
        let scoped: Bool = folder.startAccessingSecurityScopedResource()
        defer { if scoped { folder.stopAccessingSecurityScopedResource() } }
        guard folder.isFileURL else { throw NativeFailure("Only local folders can be uploaded", code: "INVALID_ARGUMENT") }
        let folderName: String = safeSegment(folder.lastPathComponent, fallback: "folder")
        let keys: [URLResourceKey] = [.isDirectoryKey, .isRegularFileKey, .fileSizeKey, .contentModificationDateKey]
        var enumerationError: Error?
        guard let enumerator = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: keys, options: [],
            errorHandler: { url, error in
                enumerationError = NativeFailure("Cannot read \(url.lastPathComponent): \(error.localizedDescription)")
                return false
            }) else {
            throw NativeFailure("Cannot list folder \(folder.lastPathComponent)")
        }
        let rootComponents: [String] = folder.standardizedFileURL.pathComponents
        var picked: [(relativePath: String, json: [String: Any])] = []
        var skipped: Int = 0
        for case let item as URL in enumerator {
            let values: URLResourceValues = try item.resourceValues(forKeys: Set(keys))
            if values.isDirectory == true { continue }
            let components: [String] = item.standardizedFileURL.pathComponents
            guard values.isRegularFile == true, components.count > rootComponents.count,
                  Array(components.prefix(rootComponents.count)) == rootComponents else {
                skipped += 1
                continue
            }
            let segments: [String] = components.dropFirst(rootComponents.count).map { safeSegment($0, fallback: "file") }
            let name: String = segments[segments.count - 1]
            let copied: URL = directory.appendingPathComponent(UUID().uuidString + "-" + name)
            try FileManager.default.copyItem(at: item, to: copied)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                                                 ofItemAtPath: copied.path)
            let relativePath: String = ([folderName] + segments).joined(separator: "/")
            var json: [String: Any] = ["uri": copied.absoluteString, "name": name, "relativePath": relativePath,
                "mimeType": UTType(filenameExtension: item.pathExtension)?.preferredMIMEType ?? "application/octet-stream",
                "size": values.fileSize ?? -1]
            if let modified = values.contentModificationDate { json["lastModified"] = modified.timeIntervalSince1970 * 1000 }
            picked.append((relativePath, json))
        }
        if let error = enumerationError { throw error }
        let files: [[String: Any]] = picked.sorted { $0.relativePath < $1.relativePath }.map { $0.json }
        return ["folderName": folderName, "files": files, "skippedCount": skipped]
    }
}
