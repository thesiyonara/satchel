import CryptoKit
import Foundation
import Security

struct CompanionError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
    init(_ message: String) { self.message = message }
}

struct PairingOffer: Decodable {
    let version: Int
    let addresses: [String]
    let port: Int
    let fingerprint: String
    let code: String
    let expires: Double

    static func read(_ input: String) throws -> Self {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefix = "syncit-phone:"
        guard value.hasPrefix(prefix), value.utf8.count <= 16384 else {
            throw CompanionError("Paste the offer from Copy for iOS in Satchel’s Phone access settings.")
        }
        var base64 = String(value.dropFirst(prefix.count)).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64), let offer = try? JSONDecoder().decode(Self.self, from: data),
              offer.version == 1, (1...65535).contains(offer.port), (1...32).contains(offer.addresses.count),
              offer.addresses.allSatisfy({ isIPv4Address($0) }),
              offer.fingerprint.range(of: #"^(?:[0-9a-fA-F]{2}:){31}[0-9a-fA-F]{2}$"#, options: .regularExpression) != nil,
              offer.code.range(of: #"^[A-Z2-9]{8}$"#, options: .regularExpression) != nil else {
            throw CompanionError("The pairing offer is incomplete. Copy a fresh one from the computer.")
        }
        guard offer.expires > Date().timeIntervalSince1970 * 1000 else {
            throw CompanionError("This offer expired. Choose Pair a phone again on the computer.")
        }
        return offer
    }

    private static func isIPv4Address(_ address: String) -> Bool {
        var parsed = in_addr()
        return inet_pton(AF_INET, address, &parsed) == 1
    }
}

struct PairedComputer: Codable {
    let host: String
    let port: Int
    let fingerprint: String
    let token: String
    let name: String
    let collection: String
}

struct CollectionFile: Decodable, Identifiable {
    let path: String
    let name: String
    let kind: String
    let size: Int64
    let preview: String?
    let modifiedAt: Double
    let conflict: Bool
    var id: String { path }
}

struct CollectionNote: Decodable, Identifiable {
    let path, text, revision: String
    let conflict: Bool?
    var id: String { path }
}
struct BoardClip: Decodable, Identifiable { let id, text: String; let time: Double }
struct SharedBoard: Decodable { let text, revision: String; let recent: [BoardClip]; let from: String? }
struct ComputerStatus: Decodable { let deviceName, collection, state: String }
private struct UploadedFile: Decodable { let path: String }
private struct SessionReply: Decodable { let ok: Bool }
struct CollectionResponse: Decodable { let items: [CollectionFile]; let error: String? }
private struct PairResponse: Decodable { let token, deviceName, collection, fingerprint: String }
private struct ErrorResponse: Decodable { let error: String }

private final class PinnedTransport: NSObject, URLSessionTaskDelegate {
    let host: String
    let fingerprint: String
    init(host: String, fingerprint: String) { self.host = host; self.fingerprint = fingerprint }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let space = challenge.protectionSpace
        guard space.authenticationMethod == NSURLAuthenticationMethodServerTrust, space.host == host,
              let trust = space.serverTrust, let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let leaf = chain.first else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        let digest = SHA256.hash(data: SecCertificateCopyData(leaf) as Data).map { String(format: "%02X", $0) }.joined(separator: ":")
        guard digest == fingerprint.uppercased() else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

struct Companion {
    let host: String
    let port: Int
    let fingerprint: String
    let token: String?
    init(computer: PairedComputer) {
        self.init(host: computer.host, port: computer.port, fingerprint: computer.fingerprint, token: computer.token)
    }
    private init(host: String, port: Int, fingerprint: String, token: String? = nil) {
        self.host = host; self.port = port; self.fingerprint = fingerprint; self.token = token
    }

    static func pair(_ offer: PairingOffer, deviceName: String = "iPhone (Satchel)") async throws -> PairedComputer {
        var lastError: Error = CompanionError("The computer could not be reached.")
        for address in offer.addresses {
            let client = Companion(host: address, port: offer.port, fingerprint: offer.fingerprint)
            do {
                let reply: PairResponse = try await client.request("/v1/pair", body: ["code": offer.code, "name": deviceName])
                guard reply.fingerprint.uppercased() == offer.fingerprint.uppercased(), !reply.token.isEmpty else {
                    throw CompanionError("The computer’s pairing reply did not match the offer.")
                }
                return PairedComputer(host: address, port: offer.port, fingerprint: offer.fingerprint, token: reply.token,
                                      name: reply.deviceName, collection: reply.collection)
            } catch let error as URLError {
                if Task.isCancelled { throw CancellationError() }
                lastError = error
            }
        }
        throw lastError
    }

    func list() async throws -> [CollectionFile] {
        let result: CollectionResponse = try await request("/v1/items")
        if let error = result.error { throw CompanionError(error) }
        return result.items
    }
    func note(_ path: String) async throws -> CollectionNote {
        try await request("/v1/note", query: [URLQueryItem(name: "path", value: path)])
    }
    func createNote(_ text: String) async throws -> CollectionNote {
        try await request("/v1/note", body: ["text": text])
    }

    func saveNote(_ note: CollectionNote, text: String) async throws -> CollectionNote {
        try await request("/v1/note", method: "PUT", body: ["path": note.path, "revision": note.revision, "text": text])
    }

    func pasteboard() async throws -> SharedBoard { try await request("/v1/pasteboard") }
    func saveBoard(_ text: String, revision: String) async throws -> SharedBoard {
        try await request("/v1/pasteboard", method: "PUT", body: ["text": text, "revision": revision])
    }
    func status() async throws -> ComputerStatus { try await request("/v1/status") }
    func disconnect() async throws {
        let _: SessionReply = try await request("/v1/session", method: "DELETE")
    }

    func upload(_ file: URL) async throws -> String {
        let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize
        guard let size, size <= 100 * 1024 * 1024 else { throw CompanionError("Files must be 100 MB or smaller.") }
        var req = try makeRequest("/v1/upload", query: [URLQueryItem(name: "name", value: file.lastPathComponent)])
        req.httpMethod = "POST"
        req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        let session = makeSession()
        defer { session.finishTasksAndInvalidate() }
        let (data, response) = try await session.upload(for: req, fromFile: file)
        try validate(response, data: data)
        return try JSONDecoder().decode(UploadedFile.self, from: data).path
    }

    // Download to disk so a video or PDF never has to fit in the app's memory.
    func download(_ file: CollectionFile, into directory: URL) async throws -> URL {
        guard !file.name.isEmpty, file.name != ".", file.name != "..", !file.name.contains("/") else {
            throw CompanionError("Invalid file name.")
        }
        let req = try makeRequest("/v1/file", query: [URLQueryItem(name: "path", value: file.path)])
        let session = makeSession()
        defer { session.finishTasksAndInvalidate() }
        let (temporary, response) = try await session.download(for: req)
        defer { try? FileManager.default.removeItem(at: temporary) }
        try validate(response)
        try Task.checkCancellation()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let destination = directory.appendingPathComponent(file.name)
        try FileManager.default.moveItem(at: temporary, to: destination)
        return destination
    }

    private func request<T: Decodable>(_ path: String, method: String? = nil, query: [URLQueryItem] = [], body: [String: String]? = nil) async throws -> T {
        var req = try makeRequest(path, query: query)
        req.httpMethod = method ?? (body == nil ? "GET" : "POST")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        let session = makeSession()
        defer { session.finishTasksAndInvalidate() }
        let (data, response) = try await session.data(for: req)
        try validate(response, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func makeRequest(_ path: String, query: [URLQueryItem]) throws -> URLRequest {
        var parts = URLComponents()
        parts.scheme = "https"; parts.host = host; parts.port = port; parts.path = path
        parts.queryItems = query.isEmpty ? nil : query
        guard let url = parts.url else { throw CompanionError("Invalid computer address.") }
        var req = URLRequest(url: url)
        if let token { req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        return req
    }

    private func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.urlCache = nil
        config.httpCookieStorage = nil
        return URLSession(configuration: config, delegate: PinnedTransport(host: host, fingerprint: fingerprint), delegateQueue: nil)
    }

    private func validate(_ response: URLResponse, data: Data? = nil) throws {
        guard let http = response as? HTTPURLResponse else { throw CompanionError("No reply from the computer.") }
        guard !(200..<300).contains(http.statusCode) else { return }
        if http.statusCode == 401 { throw CompanionError("Access was revoked. Forget this pairing in Computer, then pair again.") }
        if http.statusCode == 404, http.url?.path == "/v1/pasteboard" { throw CompanionError("Update Satchel on your computer to use its shared pasteboard.") }
        let detail = data.flatMap { try? JSONDecoder().decode(ErrorResponse.self, from: $0).error }
        throw CompanionError(detail ?? "The computer could not complete this request (HTTP \(http.statusCode)).")
    }
}
