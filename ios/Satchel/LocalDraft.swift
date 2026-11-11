import CryptoKit
import Foundation

struct LocalDraft {
    enum Document { case newNote, note(String), pasteboard }
    struct Record: Codable {
        let initial: String
        let text: String
    }
    private let directory: URL
    private let file: URL

    init(client: Companion, document: Document) {
        directory = Self.folder(for: client)
        let name: String
        switch document {
        case .newNote: name = "compose"
        case .pasteboard: name = "pasteboard"
        case .note(let path): name = "note-" + Self.digest(path)
        }
        file = directory.appendingPathComponent(name + ".json")
    }

    func load() throws -> Record? {
        do { return try JSONDecoder().decode(Record.self, from: Data(contentsOf: file)) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile { return nil }
    }
    func save(text: String, initial: String) throws {
        if text == initial { try remove(); return }
        let manager = FileManager.default
        if !manager.fileExists(atPath: directory.path) {
            try manager.createDirectory(at: directory, withIntermediateDirectories: true,
                                        attributes: [.protectionKey: FileProtectionType.complete])
            var excluded = URLResourceValues()
            excluded.isExcludedFromBackup = true
            var folder = directory
            try folder.setResourceValues(excluded)
        }
        let data = try JSONEncoder().encode(Record(initial: initial, text: text))
        try data.write(to: file, options: [.atomic, .completeFileProtection])
    }
    func remove() throws { try Self.removeIfPresent(file) }
    static func clear(for client: Companion) throws { try removeIfPresent(folder(for: client)) }

    private static func removeIfPresent(_ url: URL) throws {
        do { try FileManager.default.removeItem(at: url) }
        catch let error as CocoaError where error.code == .fileNoSuchFile { return }
    }
    private static func folder(for client: Companion) -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Drafts", isDirectory: true)
            .appendingPathComponent(digest(client.fingerprint + ":" + (client.token ?? "")), isDirectory: true)
    }
    private static func digest(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
