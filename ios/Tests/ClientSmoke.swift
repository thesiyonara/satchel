import Foundation

@main
enum ClientSmoke {
    static func main() async throws {
        guard let encoded = readLine() else { throw CompanionError("Missing test offer") }
        let offer = try PairingOffer.read(encoded)
        let incorrect = PairingOffer(version: offer.version, addresses: offer.addresses, port: offer.port,
                                     fingerprint: Array(repeating: "00", count: 32).joined(separator: ":"),
                                     code: offer.code, expires: offer.expires)
        do {
            _ = try await Companion.pair(incorrect)
            throw CompanionError("A mismatched certificate was accepted")
        } catch is URLError { /* The handshake must fail before the code is sent. */ }
        let computer = try await Companion.pair(offer)
        let client = Companion(computer: computer)
        let status = try await client.status()
        let created = try await client.createNote("Native client smoke\nHello from Swift.")
        let updated = try await client.saveNote(created, text: "First edit")
        let copy = try await client.saveNote(created, text: "Concurrent edit")
        let note = try await client.note(created.path)
        guard status.collection == computer.collection, note.text == updated.text,
              copy.conflict == true, copy.path != created.path else { throw CompanionError("Conflict-safe note editing failed") }

        let board = try await client.pasteboard()
        let first = try await client.saveBoard("https://example.org/board", revision: board.revision)
        let second = try await client.saveBoard("A replacement", revision: first.revision)
        guard second.recent.contains(where: { $0.text == first.text }) else { throw CompanionError("Missing recent clip") }
        do {
            _ = try await client.saveBoard("stale", revision: first.revision)
            throw CompanionError("Stale pasteboard write succeeded")
        } catch let error as CompanionError where error.message.contains("changed on the computer") {}
        let latest = try await client.pasteboard()
        guard latest.text == second.text else { throw CompanionError("Stale write replaced pasteboard") }

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let upload = directory.appendingPathComponent("Report & notes #2.pdf")
        let bytes = Data([0x25, 0x50, 0x44, 0x46, 0, 0xFF])
        try bytes.write(to: upload)
        let path = try await client.upload(upload)
        guard let file = try await client.list().first(where: { $0.path == path }) else { throw CompanionError("Missing upload") }
        let local = try await client.download(file, into: directory.appendingPathComponent("preview"))
        guard try Data(contentsOf: local) == bytes, local.lastPathComponent == file.name else { throw CompanionError("Binary transfer failed") }
        try await client.disconnect()
        do {
            _ = try await client.list()
            throw CompanionError("Revoked token was accepted")
        } catch let error as CompanionError where error.message.contains("revoked") {}
        print("Passed pinned pairing, status, notes and conflict copies, pasteboard history and stale writes, file transfer, and revocation.")
    }
}
