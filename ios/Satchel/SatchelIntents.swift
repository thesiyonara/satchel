import AppIntents
import Foundation

private func withPairedComputer<Value>(_ action: (Companion) async throws -> Value) async throws -> Value {
    guard let computer = try PairingStore.load() else {
        throw CompanionError("Open Satchel and pair with a computer before running this shortcut.")
    }
    do {
        try Task.checkCancellation()
        return try await action(Companion(computer: computer))
    } catch let error as URLError where [.cannotConnectToHost, .networkConnectionLost, .notConnectedToInternet, .timedOut].contains(error.code) {
        throw CompanionError("Couldn’t reach \(computer.name). Check that Phone access is on and both devices are on the same network.")
    }
}

struct SaveSatchelNoteIntent: AppIntent {
    static var title: LocalizedStringResource = "Save Note"
    static var description = IntentDescription("Create a note on the paired computer and return its collection path.")
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Note text", requestValueDialog: "What would you like to save?")
    var text: String

    static var parameterSummary: some ParameterSummary { Summary("Save \(\.$text) as a note") }

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw CompanionError("Enter text for the note.") }
        let note = try await withPairedComputer { try await $0.createNote(text) }
        return .result(value: note.path)
    }
}

struct GetSatchelPasteboardIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Shared Pasteboard"
    static var description = IntentDescription("Return the current shared text for use in another Shortcuts action.")
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let board = try await withPairedComputer { try await $0.pasteboard() }
        return .result(value: board.text)
    }
}

struct SetSatchelPasteboardIntent: AppIntent {
    static var title: LocalizedStringResource = "Set Shared Pasteboard"
    static var description = IntentDescription("Replace the shared text on the paired computer.")
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Text", requestValueDialog: "What text should go on the shared pasteboard?")
    var text: String

    static var parameterSummary: some ParameterSummary { Summary("Set the shared pasteboard to \(\.$text)") }

    func perform() async throws -> some IntentResult {
        try await withPairedComputer { client in
            let board = try await client.pasteboard()
            _ = try await client.saveBoard(text, revision: board.revision)
        }
        return .result()
    }
}

struct UploadSatchelFileIntent: AppIntent {
    static var title: LocalizedStringResource = "Add File to Collection"
    static var description = IntentDescription("Upload a file up to 100 MB and return its collection path.")
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "File") var file: IntentFile

    static var parameterSummary: some ParameterSummary { Summary("Add \(\.$file) to the collection") }

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let path = try await withPairedComputer { client in
            let name = file.filename
            guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\\") else {
                throw CompanionError("The file needs a valid name.")
            }
            if let source = file.fileURL {
                let scoped = source.startAccessingSecurityScopedResource()
                defer { if scoped { source.stopAccessingSecurityScopedResource() } }
                return try await client.upload(source, named: name)
            }
            let data = file.data
            guard data.count <= 100 * 1024 * 1024 else { throw CompanionError("Files must be 100 MB or smaller.") }
            let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: temporary) }
            try data.write(to: temporary, options: .atomic)
            return try await client.upload(temporary, named: name)
        }
        return .result(value: path)
    }
}

struct SatchelShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: SaveSatchelNoteIntent(), phrases: ["Save a note in \(.applicationName)"],
                    shortTitle: "Save Note", systemImageName: "square.and.pencil")
        AppShortcut(intent: GetSatchelPasteboardIntent(), phrases: ["Get the shared pasteboard from \(.applicationName)"],
                    shortTitle: "Get Pasteboard", systemImageName: "list.clipboard")
        AppShortcut(intent: SetSatchelPasteboardIntent(), phrases: ["Set the shared pasteboard in \(.applicationName)"],
                    shortTitle: "Set Pasteboard", systemImageName: "clipboard")
        AppShortcut(intent: UploadSatchelFileIntent(), phrases: ["Save a file to \(.applicationName)"],
                    shortTitle: "Add File", systemImageName: "doc.badge.plus")
    }
    static var shortcutTileColor: ShortcutTileColor { .orange }
}
