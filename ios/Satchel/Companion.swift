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
    var id: String { path }
}

struct CollectionNote: Decodable { let path, text, revision: String }
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

    static func pair(_ offer: PairingOffer) async throws -> PairedComputer {
        var lastError: Error = CompanionError("The computer could not be reached.")
        for address in offer.addresses {
            let client = Companion(host: address, port: offer.port, fingerprint: offer.fingerprint)
            do {
                let reply: PairResponse = try await client.request("/v1/pair", body: ["code": offer.code, "name": "iPhone (Satchel)"])
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

    private func request<T: Decodable>(_ path: String, query: [URLQueryItem] = [], body: [String: String]? = nil) async throws -> T {
        var parts = URLComponents()
        parts.scheme = "https"; parts.host = host; parts.port = port; parts.path = path
        parts.queryItems = query.isEmpty ? nil : query
        guard let url = parts.url else { throw CompanionError("Invalid computer address.") }
        var request = URLRequest(url: url)
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        config.urlCache = nil
        config.httpCookieStorage = nil
        let session = URLSession(configuration: config, delegate: PinnedTransport(host: host, fingerprint: fingerprint), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = try? JSONDecoder().decode(ErrorResponse.self, from: data).error
            throw CompanionError(message ?? "The computer could not complete this request.")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
