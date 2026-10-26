import Foundation
import Observation

/// The paired computers and the order in which to try them. The collection is the same on each, so the first reachable one wins.
@Observable
public final class ComputerStore {
    public private(set) var computers: [PairedComputer] = []
    private let file: URL

    public init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        file = support.appendingPathComponent("computers.json")
        if let data = try? Data(contentsOf: file), let saved = try? JSONDecoder().decode([PairedComputer].self, from: data) { computers = saved }
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(computers) { try? data.write(to: file, options: [.atomic, .completeFileProtection]) }
    }

    /// Pairs with the computer described by an offer: pins the fingerprint, exchanges the one-time code for a token, stores the token in the Keychain.
    public func pair(offer: PairingOffer, phoneName: String) async throws -> PairedComputer {
        var lastError: Error = URLError(.cannotConnectToHost)
        for address in offer.addresses {
            let client = APIClient(host: address, port: offer.port, fingerprint: offer.fingerprint)
            do {
                let response = try await client.pair(code: offer.code, name: phoneName)
                try Keychain.saveToken(response.token, for: response.id)
                let computer = PairedComputer(id: response.id, name: response.deviceName, collection: response.collection, addresses: offer.addresses, port: offer.port, fingerprint: offer.fingerprint, lastReached: Date())
                computers.removeAll { $0.id == computer.id }
                computers.insert(computer, at: 0)
                persist()
                return computer
            } catch { lastError = error }
        }
        throw lastError
    }

    /// A client for the first computer that answers, most recently reached first.
    public func reachableClient() async -> (PairedComputer, APIClient)? {
        for computer in computers.sorted(by: { ($0.lastReached ?? .distantPast) > ($1.lastReached ?? .distantPast) }) {
            guard let token = Keychain.token(for: computer.id) else { continue }
            for address in computer.addresses {
                let client = APIClient(host: address, port: computer.port, fingerprint: computer.fingerprint, token: token)
                if (try? await client.status()) != nil {
                    if let index = computers.firstIndex(where: { $0.id == computer.id }) { computers[index].lastReached = Date(); persist() }
                    return (computer, client)
                }
            }
        }
        return nil
    }

    public func forget(_ computer: PairedComputer) async {
        if let token = Keychain.token(for: computer.id), let address = computer.addresses.first {
            let client = APIClient(host: address, port: computer.port, fingerprint: computer.fingerprint, token: token)
            try? await client.unpair()
        }
        Keychain.deleteToken(for: computer.id)
        computers.removeAll { $0.id == computer.id }
        persist()
    }
}
