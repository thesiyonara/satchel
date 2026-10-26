# Sync it for iPhone (scaffold)

A SwiftUI client for the desktop app's **Phone access** service. The phone browses the collection on whichever paired computer is reachable, opens and edits notes, downloads files on demand and uploads photos. It keeps no copy of the collection. Design and API: [docs/MOBILE.md](../../docs/MOBILE.md).

**Status: not built yet.** These sources were written without Xcode and have not been compiled. Expect small fixes on first build.

## Create the project

1. Xcode 16 or newer, iOS 17 deployment target.
2. File → New → Project → iOS App, name `Sync it`, interface SwiftUI, language Swift. Bundle identifier of your choice (for example `local.syncit.phone`).
3. Delete the generated `ContentView.swift`; add the folders `SyncItKit` and `App` from this directory to the target (copy items if needed).
4. In the target's Info, add:
   - `NSCameraUsageDescription`: "Scans the pairing code shown by Sync it on your computer."
   - `NSLocalNetworkUsageDescription`: "Connects to your paired computers on the local network to show your collection."
   - `NSPhotoLibraryUsageDescription` is not required; photo upload uses `PhotosPicker`.
5. Build and run on a device on the same Wi-Fi as a computer with Phone access turned on.

## Pairing

On the computer: Preferences → Phone access → **Pair a phone**. In the app: **Add computer**, scan the QR code (or type the code and the computer's address). The app verifies the TLS certificate fingerprint from the QR payload before sending the code, then stores the bearer token and fingerprint in the Keychain.

## Layout

- `SyncItKit/Models.swift`: Codable models mirroring the API.
- `SyncItKit/PairingOffer.swift`: parses `syncit-phone:` payloads.
- `SyncItKit/Keychain.swift`: credential storage per computer.
- `SyncItKit/APIClient.swift`: `URLSession` with certificate pinning and the v1 endpoints.
- `SyncItKit/ComputerStore.swift`: the paired computers and reachability order.
- `App/SyncItApp.swift`, `App/ComputersView.swift`, `App/PairView.swift`, `App/CollectionView.swift`, `App/NoteView.swift`: the screens.

Keep the desktop vocabulary: collection, paired computers, notes, files.
