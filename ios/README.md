# Satchel for iPhone and iPad

Satchel connects to a computer running the desktop app on the same network. The native app runs on iOS and iPadOS 17 or later. Use desktop version 1.0.0 or later for shared pasteboard and in-app QR pairing.

### Pair a computer

1. Open **Preferences → Phone access** in desktop Satchel, enable access and choose **Pair a phone**.
2. Choose **Show iOS app QR code**, then tap **Scan pairing code** in Satchel on the phone. Alternatively, choose **Copy for iOS** and paste the offer into the phone app.
3. Tap **Pair computer**. Allow local-network access when prompted. Each offer expires after five minutes and pairs one device.

### Use the collection

- Search filenames, paths and note excerpts. Filter by kind, sort by name or latest change, and pull to refresh.
- Use **+** to write a note, upload from Files, or select photos and videos. Uploads run while the app is active and report individual failures. The desktop limit is 100 MiB per file.
- Open a note to read, share, or edit it. If another device changed it first, Satchel keeps both versions and shows where it saved your edit.
- Open a file and tap **Download to preview or share**. Quick Look previews supported formats including images, PDFs, audio and video. The share sheet can save the original to Files or open it in another app.
- In **Pasteboard**, copy or edit the shared text, follow highlighted web links, or open a recent clip. If a newer edit reaches the computer before yours, the editor keeps your draft available to copy.
- **Computer** shows desktop sync status and lets you revoke the phone’s access. When offline, you can forget the local pairing and revoke the credential later on the computer.

Pairing pins the offered certificate before sending the one-time code. The app keeps one pairing in device-only Keychain. Collections are accessed on demand. Previews download to temporary storage. A new computer address or certificate requires a fresh offer.

### iOS shortcuts and sharing

- In another app, open the system share sheet and choose **Satchel** to send text, a URL or files to your paired computer. Shared text can become a note or replace the shared pasteboard.
- In Shortcuts, search for **Satchel** to save a note, get or set the shared pasteboard, or upload a file. These actions use the same paired computer as the app.
- Add the **Satchel** widget to your Home Screen to open the collection, compose a note, or open the pasteboard. The Lock Screen widget opens the note composer. Touch and hold the app icon for **New note** and **Pasteboard**.
- Unsaved edits are kept locally with file protection and excluded from backup. Reopen the same editor to recover a draft. Disconnecting or forgetting the computer clears its drafts.

### Build and test

Open `Satchel.xcodeproj` in Xcode 16 or newer. Select a simulator, or choose a signing team and a connected device for a physical install. The **iOS client** GitHub workflow builds an unsigned device target and provides a runnable simulator app and XCTest results. TestFlight requires a signed distribution build.

The workflow exercises the Swift HTTP client against an isolated desktop service, including certificate rejection, conflicting notes, pasteboard revisions, file transfers and token revocation. It then pairs the simulator app with a fresh service and exercises the interface with XCTest.
