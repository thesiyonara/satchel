import Foundation

/// The QR payload shown by the desktop: "syncit-phone:" followed by base64url JSON.
public struct PairingOffer: Codable {
    public let version: Int
    public let name: String
    public let addresses: [String]
    public let port: Int
    public let fingerprint: String
    public let code: String
    public let expires: Double

    public var isExpired: Bool { Date(timeIntervalSince1970: expires / 1000) < Date() }

    public static func parse(_ text: String) -> PairingOffer? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("syncit-phone:") else { return nil }
        var base64 = String(trimmed.dropFirst("syncit-phone:".count))
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64.append("=") }
        guard let data = Data(base64Encoded: base64),
              let offer = try? JSONDecoder().decode(PairingOffer.self, from: data),
              offer.version == 1, offer.port > 0, offer.port < 65536,
              offer.fingerprint.range(of: #"^([A-F0-9]{2}:){31}[A-F0-9]{2}$"#, options: .regularExpression) != nil
        else { return nil }
        return offer
    }

    /// A typed fallback when the camera is unavailable: the eight-character code plus "address:port" and the fingerprint read from the computer's screen.
    public static func manual(code: String, address: String, fingerprint: String, name: String = "Computer") -> PairingOffer? {
        let parts = address.split(separator: ":")
        guard let host = parts.first, !host.isEmpty else { return nil }
        let port = parts.count > 1 ? Int(parts[1]) ?? 22028 : 22028
        let normalizedFingerprint = fingerprint.uppercased().filter { $0.isHexDigit || $0 == ":" }
        return PairingOffer(version: 1, name: name, addresses: [String(host)], port: port, fingerprint: normalizedFingerprint, code: code.uppercased(), expires: Date().addingTimeInterval(300).timeIntervalSince1970 * 1000)
    }
}
