import AppIntents
import Foundation

// The standalone macOS smoke binary gets its only pairing from the disposable test companion.
// Production actions use the app's Keychain-backed PairingStore.
enum PairingStore {
    static var computer: PairedComputer?
    static func load() throws -> PairedComputer? { computer }
}

enum ShortcutSmoke {
    static func run(using computer: PairedComputer, directory: URL) async throws {
        try await checkNavigation()
        let reader = GetSatchelPasteboardIntent()
        do {
            _ = try await reader.perform()
            throw CompanionError("The shortcut ran without pairing")
        } catch let error as CompanionError where error.message.contains("pair with a computer") {}
        PairingStore.computer = computer
        defer { PairingStore.computer = nil }
        let client = Companion(computer: computer)

        var save = SaveSatchelNoteIntent()
        save.text = "Shortcut note\nA note saved from a workflow."
        guard let path = try await save.perform().value else { throw CompanionError("The note shortcut returned no path") }
        let note = try await client.note(path)
        guard note.text == save.text else { throw CompanionError("Shortcut did not save note text") }

        var writer = SetSatchelPasteboardIntent()
        writer.text = "Shortcuts: https://example.org/a?b=2"
        _ = try await writer.perform()
        guard try await reader.perform().value == writer.text else { throw CompanionError("Pasteboard shortcuts lost text") }

        let contents = Data([0x00, 0xDE, 0xAD, 0xFF])
        var uploader = UploadSatchelFileIntent()
        let source = directory.appendingPathComponent("provider-temporary-name")
        try contents.write(to: source)
        let inputs = [
            IntentFile(fileURL: source, filename: "From Files.bin"),
            IntentFile(data: contents, filename: "From Memory.bin")
        ]
        for input in inputs {
            uploader.file = input
            guard let uploadedPath = try await uploader.perform().value,
                  let item = try await client.list().first(where: { $0.path == uploadedPath }),
                  item.name == input.filename else { throw CompanionError("Shortcut file name was not preserved") }
            let output = try await client.download(item, into: directory.appendingPathComponent("shortcuts"))
            guard try Data(contentsOf: output) == contents else { throw CompanionError("Shortcut file content changed") }
        }
        print("Passed Save Note, Get and Set Shared Pasteboard, Add File (disk and memory), and missing pairing.")
    }
    @MainActor
    private static func checkNavigation() throws {
        let route = SatchelNavigation()
        guard route.open(URL(string: "satchel://compose")!), route.composing,
              !route.open(URL(string: "https://example.org/")!) else { throw CompanionError("Cold compose routing failed") }
        route.beginEditingDraft()
        _ = route.open(URL(string: "satchel://pasteboard")!)
        guard route.tab == .collection && route.composing else { throw CompanionError("A warm URL displaced a draft") }
        route.endEditingDraft()
        guard route.tab == .pasteboard && !route.composing else { throw CompanionError("The pending pasteboard did not open") }
        _ = route.open(URL(string: "satchel://compose?text=unrequested")!)
        guard route.tab == .pasteboard && !route.composing else { throw CompanionError("An unsupported URL changed navigation") }
    }

}
