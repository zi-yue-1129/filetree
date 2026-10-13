import Foundation

/// Runtime-independent contract checks compiled with the production TUS parser.
@main
struct ProtocolChecks {
    /// Run metadata, proxy origin, offset and retry regressions.
    static func main() throws -> Void {
        let origin: URL = try url("https://files.example.com")
        let metadata: [String: String] = ["filename": "測試 file.jpg", "filetype": "image/jpeg", "token": "secret",
                                        "folder_id": "folder", "relativePath": "旅行/測試 file.jpg"]
        let encoded: String = TUSProtocol.metadata(metadata)
        var decoded: [String: String] = [:]
        for item: Substring in encoded.split(separator: ",") {
            let pair: [Substring] = item.split(separator: " ", maxSplits: 1)
            guard pair.count == 2, let data = Data(base64Encoded: String(pair[1])), let value = String(data: data, encoding: .utf8) else {
                throw NativeFailure("Metadata is not valid UTF-8 base64")
            }
            decoded[String(pair[0])] = value
        }
        precondition(decoded == metadata, "Metadata lost Unicode or token values")
        let rewritten: URL = try TUSProtocol.location("http://backend:5168/api/upload/tus/abc", origin: origin)
        precondition(rewritten.absoluteString == "https://files.example.com/api/upload/tus/abc")
        let relative: URL = try TUSProtocol.location("/api/upload/tus/abc", origin: origin)
        precondition(relative.host == "files.example.com")
        let emptyOffset: Int64 = try TUSProtocol.offset("0", total: 0)
        precondition(emptyOffset == 0)
        let fullOffset: Int64 = try TUSProtocol.offset("123", total: 123)
        precondition(fullOffset == 123)
        try expectFailure { _ = try TUSProtocol.offset(nil, total: 123) }
        try expectFailure { _ = try TUSProtocol.offset("-1", total: 123) }
        try expectFailure { _ = try TUSProtocol.offset("124", total: 123) }
        try expectFailure { _ = try TUSProtocol.offset("invalid", total: 123) }
        try expectFailure { _ = try TUSProtocol.location(nil, origin: origin) }
        try expectFailure { _ = try TUSProtocol.location("/other/abc", origin: origin) }
        precondition(!TUSProtocol.retryable(401) && !TUSProtocol.retryable(403) && !TUSProtocol.retryable(413))
        precondition(TUSProtocol.retryable(409) && TUSProtocol.retryable(429) && TUSProtocol.retryable(503))
        precondition(TUSProtocol.accepts(200, stage: "create") && TUSProtocol.accepts(201, stage: "create"))
        precondition(!TUSProtocol.accepts(204, stage: "create") && !TUSProtocol.accepts(200, stage: "patch"))
        precondition(!TUSProtocol.completed(stage: "head", offset: 0, total: 0))
        precondition(TUSProtocol.completed(stage: "patch", offset: 0, total: 0))
        print("PASS: TUS metadata, proxy Location, offset bounds, empty uploads and retry classification")
    }

    private static func url(_ value: String) throws -> URL {
        guard let url = URL(string: value) else { throw NativeFailure("Invalid fixture URL") }
        return url
    }

    private static func expectFailure(_ operation: () throws -> Void) throws -> Void {
        do { try operation() } catch is NativeFailure { return }
        throw NativeFailure("Expected validation failure was not raised")
    }
}
