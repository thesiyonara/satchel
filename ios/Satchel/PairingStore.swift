import Foundation
import Security

enum PairingStore {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "local.satchel.phone",
        kSecAttrAccount as String: "paired-computer"
    ]

    static func load() throws -> PairedComputer? {
        var options = query
        options[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(options as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw CompanionError("Could not read the pairing from Keychain.") }
        return try JSONDecoder().decode(PairedComputer.self, from: data)
    }

    static func save(_ computer: PairedComputer) throws {
        let values: [String: Any] = [kSecValueData as String: try JSONEncoder().encode(computer),
                                    kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(values) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw CompanionError("Could not save the pairing to Keychain.") }
    }

    static func forget() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw CompanionError("Could not remove the pairing from Keychain.") }
    }
}
