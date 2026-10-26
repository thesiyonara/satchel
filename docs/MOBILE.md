# Phone access and the iPhone app (groundwork)

## Shape of the feature

The computers hold the collection and sync it between themselves. A phone is a **client of whichever computer is reachable**, not a third copy: it browses the collection, opens notes, downloads a file when asked, and can add a note or a photo. It stores nothing beyond a small cache and the credentials for each paired computer. That keeps phone storage out of the sync, avoids a Syncthing port on iOS (there is no official one), and means the phone sees the same collection through either computer.

The desktop side of this is implemented and tested on Windows; the iOS app exists as a scaffold under `mobile/ios` that has not been built yet.

## Desktop: the phone access service

Off by default. **Preferences → Phone access** turns it on; the app then serves `https://<this computer>:22028` on the local network only (requests from outside the attached IPv4 subnets are refused). Implementation: `electron/companion.ts`.

- **Transport.** TLS 1.2+ with a certificate generated locally on first use (`phone-cert.pem`, `phone-key.pem` in private app storage, EC P-256, ten years). The phone pins the certificate's SHA-256 fingerprint received during pairing, so a substituted certificate is rejected even though no authority signs it.
- **Pairing.** **Pair a phone** opens a five-minute, single-use window with an eight-character code and shows a QR code. The QR payload is `syncit-phone:` followed by base64url JSON: `{ version: 1, name, addresses, port, fingerprint, code, expires }`. The phone connects to the first reachable address, checks the fingerprint, and posts the code. Five wrong codes close the window. The reply carries a 256-bit bearer token; the computer stores only its SHA-256 hash in `phone-devices.json`.
- **Access.** Every other request needs `Authorization: Bearer <token>`. Paired phones are listed under Phone access with their last-seen time and can be removed there; a phone can also unpair itself. Revocation is immediate.
- **Limits.** JSON bodies up to 2 MB, uploads up to 100 MB, 32 connections. Paths go through the same containment and reserved-name checks as the desktop UI, so `.syncit`, `.stversions` and anything outside the collection are unreachable.

### API (v1, JSON unless noted)

| Method and path | Body or query | Result |
| --- | --- | --- |
| `POST /v1/pair` | `{ code, name }` | `{ token, id, deviceName, collection, fingerprint }` |
| `GET /v1/status` | | `{ deviceName, collection, state, phone, phones }` |
| `GET /v1/items` | | `{ items, placements, error? }` (note previews cut to 400 characters) |
| `GET /v1/note?path=` | | `{ path, text, revision }` |
| `POST /v1/note` | `{ text }` | the created note |
| `PUT /v1/note` | `{ path, text, revision }` | the saved note; a stale revision produces a conflict copy, as on the desktop |
| `GET /v1/file?path=` | | the file bytes, `Content-Disposition: attachment` |
| `GET /v1/thumbnail?path=` | | PNG preview, same limits as the desktop grid |
| `POST /v1/upload?name=` | raw bytes | `{ path }` under a cleaned, non-colliding name |
| `DELETE /v1/session` | | unpairs this phone |

Errors are `{ error }` with 400, 401, 403, 404, 413 or 429.

CLI: `node scripts/syncit.mjs phone status|pair|cancel|revoke ID`. `pair` returns the offer and its encoded QR payload, which is useful for testing a client without the dashboard.

## iPhone app

`mobile/ios` contains a SwiftUI scaffold: pairing by QR scan or typed code, a collection list with thumbnails, a note viewer and editor with the same revision-based save, file download to the share sheet, and photo upload. `SyncItKit` holds the models, the API client with certificate pinning (`URLSessionDelegate` compares the server certificate's SHA-256 to the pinned fingerprint), the QR payload parser and Keychain storage. It targets iOS 17 and needs an Xcode project created around it; see `mobile/ios/README.md`. None of it has been compiled or run yet.

Multiple computers: the phone keeps one credential per paired computer and tries them in order, so it works through whichever computer is on. Pair the phone with each computer separately; the collection is the same.

## Decisions and what is deferred

- **No background sync on the phone** and no push: the phone pulls when opened. Offline, it shows its last list and cached notes read-only.
- **No internet relay.** Phone access is LAN-only, like everything else. A later option could reuse a trusted computer as a relay over a VPN the user already runs; nothing here depends on cloud services.
- **Conflicts** follow the desktop rule: saving with a stale revision keeps both versions.
- **Not yet done:** building and testing the iOS app; a native Mac check of the service (it is platform-neutral Node code); mDNS or Bonjour discovery of computers from the phone (the QR carries addresses, which is enough for a first version); range requests for large downloads.
