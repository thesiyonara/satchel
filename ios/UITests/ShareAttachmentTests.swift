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
