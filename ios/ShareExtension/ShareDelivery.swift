import Foundation

enum ShareDestination { case note, pasteboard }

struct ShareReceipt {
    var text = false
    var files: Set<URL> = []
}

enum ShareDelivery {
    @MainActor
    static func send(text: String, destination: ShareDestination, files: [URL], client: Companion,
                     previous: ShareReceipt, acknowledged: (ShareReceipt) -> Void) async throws {
        var receipt = previous
        try Task.checkCancellation()
        if !receipt.text && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            guard text.utf8.count <= 1024 * 1024 else { throw ShareInputError("Shorten the text to 1 MB or less.") }
            switch destination {
            case .note: _ = try await client.createNote(text)
            case .pasteboard:
                let board = try await client.pasteboard()
                _ = try await client.saveBoard(text, revision: board.revision)
            }
            receipt.text = true
            acknowledged(receipt)
        }
        for file in files where !receipt.files.contains(file) {
            try Task.checkCancellation()
            _ = try await client.upload(file)
            receipt.files.insert(file)
            acknowledged(receipt)
        }
    }
}
