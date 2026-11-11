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
        } catch is URLError { /* URLSession rejected the handshake before sending the code. */ }
        let computer = try await Companion.pair(offer)
        let client = Companion(computer: computer)
        let created = try await client.createNote("Native client smoke\nHello from Swift.")
        let files = try await client.list()
        let note = try await client.note(created.path)
        guard files.contains(where: { $0.path == created.path }), note.text == created.text else {
            throw CompanionError("Note round trip failed")
        }
        print("Swift client passed pairing, certificate mismatch rejection, note creation, collection listing and note reading.")
    }
}
