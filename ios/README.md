# Satchel for iOS

Open `Satchel.xcodeproj` in Xcode 16 or newer. The SwiftUI app targets iOS 17 and later. Select an iPhone simulator, or select a signing team and a connected iPhone to run it on a device.

1. Put the phone and computer on the same local network. On the computer, open **Preferences → Phone access**, enable access, then choose **Pair a phone → Copy for iOS**.
2. Transfer the offer to the iPhone and paste it into **Pairing offer** before it expires. Choose **Pair computer** and allow local-network access.
3. Browse and search files, open notes, or use the compose button to save a new note directly to the computer. Pull down to refresh the collection.

The client pins the offered certificate before sending the one-time code. The computer address, fingerprint and bearer token are stored in this device’s Keychain. Use **Computer actions → Forget this computer** to clear the local pairing. The computer’s **Phone access** screen can revoke the credential.

This first version supports one computer at a time. Non-note items show their path and size. The browser client also supports file previews, uploads and editing existing notes. A changed computer address requires a fresh pairing offer.

From the repository root on a Mac with Xcode, run the Swift networking smoke test against an isolated instance of the desktop phone service:

```sh
npm ci
npx --no-install tsx scripts/ios-client-test.ts
xcodebuild -project ios/Satchel.xcodeproj -scheme Satchel -destination 'generic/platform=iOS Simulator' build
```
