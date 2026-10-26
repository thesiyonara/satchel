import CryptoKit
import Foundation

/// Talks to one computer's Phone access service. Trust is the pinned certificate fingerprint from pairing, not a certificate authority.
public final class APIClient: NSObject, URLSessionDelegate {
    public let baseURL: URL
    public let fingerprint: String
    public var token: String?
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    public init(host: String, port: Int, fingerprint: String, token: String? = nil) {
        self.baseURL = URL(string: "https://\(host):\(port)")!
        self.fingerprint = fingerprint.uppercased()
        self.token = token
    }

    // MARK: Certificate pinning

    public func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust,
              let certificates = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let leaf = certificates.first
        else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        let der = SecCertificateCopyData(leaf) as Data
        let digest = SHA256.hash(data: der).map { String(format: "%02X", $0) }.joined(separator: ":")
        if digest == fingerprint { completionHandler(.useCredential, URLCredential(trust: trust)) }
        else { completionHandler(.cancelAuthenticationChallenge, nil) }
    }

    // MARK: Requests

    private func request(_ method: String, _ path: String, query: [String: String] = [:], json: Encodable? = nil, body: Data? = nil, contentType: String? = nil) async throws -> (Data, HTTPURLResponse) {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let json {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(AnyEncodable(json))
        } else if let body {
            request.setValue(contentType ?? "application/octet-stream", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        if http.statusCode >= 400 {
            if let error = try? JSONDecoder().decode(APIError.self, from: data) { throw error }
            throw URLError(.badServerResponse)
        }
        return (data, http)
    }

    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T { try JSONDecoder().decode(type, from: data) }

    public func pair(code: String, name: String) async throws -> PairResponse {
        let (data, _) = try await request("POST", "v1/pair", json: ["code": code, "name": name])
        let response = try decode(PairResponse.self, data)
        token = response.token
        return response
    }

    public func status() async throws -> StatusResponse { try decode(StatusResponse.self, try await request("GET", "v1/status").0) }
    public func items() async throws -> ItemsResponse { try decode(ItemsResponse.self, try await request("GET", "v1/items").0) }
    public func note(path: String) async throws -> NoteDocument { try decode(NoteDocument.self, try await request("GET", "v1/note", query: ["path": path]).0) }
    public func createNote(text: String) async throws -> NoteDocument { try decode(NoteDocument.self, try await request("POST", "v1/note", json: ["text": text]).0) }
    public func saveNote(path: String, text: String, revision: String) async throws -> NoteDocument {
        try decode(NoteDocument.self, try await request("PUT", "v1/note", json: ["path": path, "text": text, "revision": revision]).0)
    }
    public func file(path: String) async throws -> Data { try await request("GET", "v1/file", query: ["path": path]).0 }
    public func thumbnail(path: String) async throws -> Data { try await request("GET", "v1/thumbnail", query: ["path": path]).0 }
    public func upload(name: String, data: Data, contentType: String) async throws -> String {
        struct Uploaded: Decodable { let path: String }
        return try decode(Uploaded.self, try await request("POST", "v1/upload", query: ["name": name], body: data, contentType: contentType).0).path
    }
    public func unpair() async throws { _ = try await request("DELETE", "v1/session") }
}

/// Lets `request` encode plain dictionaries and models alike.
struct AnyEncodable: Encodable {
    private let encodeValue: (Encoder) throws -> Void
    init(_ value: Encodable) { encodeValue = value.encode }
    func encode(to encoder: Encoder) throws { try encodeValue(encoder) }
}
