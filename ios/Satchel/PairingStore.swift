import Foundation
import Security

enum PairingStore {
    private static let shared = "local.satchel.phone.shared-pairing"
    private static let legacy = "local.satchel.phone"

    private static func query(_ service: String) -> [String: Any] {
        var result: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: "paired-computer"]
        #if !targetEnvironment(simulator)
        if service == shared, let group = Bundle.main.object(forInfoDictionaryKey: "SatchelPairingAccessGroup") as? String {
            result[kSecAttrAccessGroup as String] = group
        }
        #endif
        return result
    }

    private static func read(_ service: String) throws -> PairedComputer? {
        var options = query(service)
        options[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(options as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw CompanionError("Could not read the pairing from Keychain.") }
        return try JSONDecoder().decode(PairedComputer.self, from: data)
    }

    static func load() throws -> PairedComputer? {
        if let computer = try read(shared) { return computer }
        // Only the app can access entries from before Keychain Sharing. Copy before removing the original.
        guard let computer = try read(legacy) else { return nil }
        try save(computer)
        return computer
    }

    static func save(_ computer: PairedComputer) throws {
        // Both targets name the pairing group first in their signed entitlements, making it the add default.
        let values: [String: Any] = [kSecValueData as String: try JSONEncoder().encode(computer),
                                    kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let destination = query(shared)
        var status = SecItemUpdate(destination as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(destination.merging(values) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw CompanionError("Could not save the pairing to Keychain.") }
        try remove(legacy)
    }

    private static func remove(_ service: String) throws {
        let status = SecItemDelete(query(service) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw CompanionError("Could not remove the pairing from Keychain.") }
    }

    static func forget() throws {
        try remove(legacy)
        try remove(shared)
    }
}
