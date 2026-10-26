import Foundation

/// Mirrors the desktop API (docs/MOBILE.md). Field names match the JSON exactly.
public enum ItemKind: String, Codable { case note, image, file }

public struct LibraryItem: Codable, Identifiable, Hashable {
    public var id: String { path }
    public let path: String
    public let name: String
    public let kind: ItemKind
    public let size: Int64
    public let modifiedAt: Double
    public let preview: String?
    public let conflict: Bool

    public var folder: String { path.contains("/") ? String(path[..<path.lastIndex(of: "/")!]) : "" }
    public var title: String { kind == .note ? name.replacingOccurrences(of: #"\.(md|txt)$"#, with: "", options: .regularExpression) : name }
    public var modified: Date { Date(timeIntervalSince1970: modifiedAt / 1000) }
}

public struct ItemsResponse: Codable {
    public let items: [LibraryItem]
    public let error: String?
}

public struct NoteDocument: Codable {
    public let path: String
    public let text: String
    public let revision: String
    public let conflict: Bool?
}

public struct StatusResponse: Codable {
    public let deviceName: String
    public let collection: String
    public let state: String
}

public struct PairResponse: Codable {
    public let token: String
    public let id: String
    public let deviceName: String
    public let collection: String
    public let fingerprint: String
}

public struct APIError: Codable, Error, LocalizedError {
    public let error: String
    public var errorDescription: String? { error }
}

/// A computer the phone has paired with. Credentials live in the Keychain, keyed by `id`.
public struct PairedComputer: Codable, Identifiable, Hashable {
    public let id: String
    public var name: String
    public var collection: String
    public var addresses: [String]
    public var port: Int
    public var fingerprint: String
    public var lastReached: Date?
}
