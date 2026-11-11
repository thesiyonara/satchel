import XCTest
import UniformTypeIdentifiers

final class ShareAttachmentTests: XCTestCase {
    func testTextLinkAndNamedFileSelections() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".csv")
        let bytes = Data("name,count\nField notes,2\n".utf8)
        try bytes.write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let attachment = NSItemProvider(item: file as NSURL, typeIdentifier: UTType.fileURL.identifier)
        attachment.suggestedName = "Inventory.csv"
        let duplicate = NSItemProvider(item: file as NSURL, typeIdentifier: UTType.fileURL.identifier)
        duplicate.suggestedName = "Inventory.csv"
        let link = try XCTUnwrap(URL(string: "https://example.com/notes"))
        let item = NSExtensionItem()
        item.attachments = [NSItemProvider(item: "Read this" as NSString, typeIdentifier: UTType.plainText.identifier),
                            NSItemProvider(item: link as NSURL, typeIdentifier: UTType.url.identifier), attachment, duplicate]
        var staging: ShareStaging? = try ShareStaging()
        let result = try await XCTUnwrap(staging).read([item])
        XCTAssertEqual(result.text, "Read this\n\nhttps://example.com/notes")
        XCTAssertEqual(result.files.map(\.lastPathComponent), ["Inventory.csv", "Inventory.csv"])
        XCTAssertEqual(Set(result.files).count, 2)
        try FileManager.default.removeItem(at: file)
        for url in result.files { XCTAssertEqual(try Data(contentsOf: url), bytes) }
        staging = nil
        for url in result.files { XCTAssertFalse(FileManager.default.fileExists(atPath: url.path)) }
    }

    @MainActor
    func testSendAndRetryOnlyTheRemainingItems() async throws {
        let endpoint = try XCTUnwrap(URL(string: "http://127.0.0.1:31926/offer"))
        let (data, _) = try await URLSession.shared.data(from: endpoint)
        let offer = try XCTUnwrap(String(data: data, encoding: .utf8))
        let computer = try await Companion.pair(PairingOffer.read(offer), deviceName: "Share sheet test")
        let client = Companion(computer: computer)
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: folder) }
        let receiptNote = "Share receipt " + UUID().uuidString
        let first = folder.appendingPathComponent("First-" + UUID().uuidString + ".csv")
        let second = folder.appendingPathComponent("Second-" + UUID().uuidString + ".csv")
        try Data("first".utf8).write(to: first)
        var receipt = ShareReceipt()
        do {
            try await ShareDelivery.send(text: receiptNote, destination: .note, files: [first, second], client: client,
                                         previous: receipt) { receipt = $0 }
            XCTFail("Sending a missing file should fail")
        } catch {
            XCTAssertTrue(receipt.text)
            XCTAssertEqual(receipt.files, [first])
        }
        try Data("second".utf8).write(to: second)
        try await ShareDelivery.send(text: receiptNote, destination: .note, files: [first, second], client: client,
                                     previous: receipt) { receipt = $0 }
        let entries = try await client.list()
        for prefix in [receiptNote, first.deletingPathExtension().lastPathComponent, second.deletingPathExtension().lastPathComponent] {
            XCTAssertEqual(entries.filter { $0.name.hasPrefix(prefix) }.count, 1)
        }
        let original = try await client.pasteboard()
        let link = "https://example.com/share"
        try await ShareDelivery.send(text: link, destination: .pasteboard, files: [], client: client,
                                     previous: ShareReceipt()) { _ in }
        let board = try await client.pasteboard()
        XCTAssertEqual(board.text, link)
        _ = try await client.saveBoard(original.text, revision: board.revision)
        try await client.disconnect()
    }

    func testImageFileRepresentationAndCaption() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent("provider.png")
        let bytes = Data([137, 80, 78, 71, 13, 10, 26, 10])
        try bytes.write(to: file)
        let provider = NSItemProvider()
        provider.suggestedName = "Diagram"
        provider.registerFileRepresentation(forTypeIdentifier: UTType.png.identifier, fileOptions: [], visibility: .all) { finish in
            finish(file, false, nil); return nil
        }
        let item = NSExtensionItem()
        item.attributedContentText = NSAttributedString(string: "Layout for review")
        item.attachments = [provider]
        let staging = try ShareStaging()
        let result = try await staging.read([item])
        XCTAssertEqual(result.text, "Layout for review")
        let received = try XCTUnwrap(result.files.first)
        XCTAssertEqual(received.lastPathComponent, "Diagram.png")
        XCTAssertEqual(try Data(contentsOf: received), bytes)
        withExtendedLifetime(staging) {}
    }
}
