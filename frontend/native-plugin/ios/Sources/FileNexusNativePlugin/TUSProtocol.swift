import Foundation

/// Validated wire operations shared by the app and its extension.
enum TUSProtocol {
    /// Encode metadata values individually according to TUS 1.0.
    static func metadata(_ values: [String: String]) -> String {
        return values.sorted { $0.key < $1.key }.map {
            "\($0.key) \(Data($0.value.utf8).base64EncodedString())"
        }.joined(separator: ",")
    }

    /// Resolve Location against the configured origin, replacing proxy-internal hosts.
    static func location(_ value: String?, origin: URL) throws -> URL {
        guard let value = value, let supplied = URL(string: value, relativeTo: origin),
              var components = URLComponents(url: supplied.absoluteURL, resolvingAgainstBaseURL: true),
              let server = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              components.path.hasPrefix("/api/upload/tus/") else {
            throw NativeFailure("TUS creation response has an invalid Location")
        }
        components.scheme = server.scheme
        components.host = server.host
        components.port = server.port
        components.user = nil
        components.password = nil
        components.fragment = nil
        guard let url = components.url else { throw NativeFailure("TUS Location cannot be resolved") }
        return url
    }

    /// Require a valid server offset within the original file bounds.
    static func offset(_ value: String?, total: Int64) throws -> Int64 {
        guard let value = value, let offset = Int64(value), offset >= 0, offset <= total else {
            throw NativeFailure("TUS response has an invalid Upload-Offset")
        }
        return offset
    }

    /// The backend may return an existing active fingerprint with HTTP 200.
    static func accepts(_ status: Int, stage: String) -> Bool {
        switch stage {
        case "create": return status == 200 || status == 201
        case "head": return status == 200
        case "patch": return status == 204
        default: return false
        }
    }

    /// Empty files still require PATCH to trigger backend import/finalization.
    static func completed(stage: String, offset: Int64, total: Int64) -> Bool {
        return offset == total && (total > 0 || stage == "patch")
    }

    /// Distinguish permanent auth/validation errors from recoverable conflicts.
    static func retryable(_ status: Int) -> Bool {
        return status == 408 || status == 409 || status == 423 || status == 429 || status >= 500
    }
}

/// A surfaced native error with a stable JavaScript rejection code.
struct NativeFailure: LocalizedError {
    let message: String
    let code: String
    let retryable: Bool
    var errorDescription: String? { return message }

    /// Create an actionable error without exposing credentials.
    init(_ message: String, code: String = "IO_ERROR", retryable: Bool = false) {
        self.message = message
        self.code = code
        self.retryable = retryable
    }
}
