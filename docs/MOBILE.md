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
| `GET /v1/thumbnail?path=` | | PNG preview of an image, video or PDF, same limits as the desktop grid |
| `GET /v1/preview?path=` | | larger OS-rendered PNG, used for images the phone's browser cannot decode (HEIC, TIFF) |
| `GET /v1/text?path=` | | `{ path, text }` for text-like files up to 1 MB (CSV, JSON, code, logs) |
| `POST /v1/media-ticket` | `{ path }` | `{ url, expires }`: a ten-minute link for one video or audio file, because media elements cannot send the token |
| `GET /v1/stream?ticket=` | `Range` header honoured | the media bytes (200, 206 or 416); no token needed, the ticket is the credential |
| `POST /v1/upload?name=` | raw bytes | `{ path }` under a cleaned, non-colliding name |
| `DELETE /v1/session` | | unpairs this phone |

Errors are `{ error }` with 400, 401, 403, 404, 413 or 429.

CLI: `node scripts/syncit.mjs phone status|pair|cancel|revoke ID`. `pair` returns the offer and its encoded QR payload, which is useful for testing a client without the dashboard.

## The phone client is a web page

The service also serves a small web app at `https://<computer>:22028/` (`web/index.html`, `app.js`, `app.css`, `manifest.webmanifest`, `icon.png`, bundled with the desktop app). The pairing QR code is simply `https://<address>:22028/#pair=<code>`: pointing the phone's camera at it opens the page in the browser, which pairs with the one-time code, drops the code from the address, and keeps the bearer token in that site's storage. **Add to Home Screen** gives it an icon and a standalone window.

What it does: list the collection with search over names, folders and note text; open and edit notes with the same revision rule as the desktop (a stale save becomes a conflict copy); create notes; show image previews and download any file on demand, which hands it to the browser's download or share sheet; upload a photo or file from the phone; unpair. Nothing is cached beyond the current page; closing it leaves no copy of the collection on the phone.

Security: the page is served with a strict Content Security Policy (`default-src 'none'`, scripts and styles only from the same origin, no inline code), builds its interface with DOM APIs so collection contents can never inject markup, sends the token only in an `Authorization` header (no cookies, so no cross-site request forgery), and the service serves only its five fixed files; everything under `/v1/` still needs the token. The certificate is self-signed, so the browser warns once per computer; the fingerprint shown under Phone access is there to compare against the browser's certificate details. One computer per page: pair the phone with each computer you want to reach and keep one icon per computer.

Tested end to end by `npm run test:web`: the real desktop app serves the page over TLS to an isolated browser session that pairs by URL, lists, edits a note, creates one, uploads a file, searches, downloads, and unpairs.

## Native iPhone app (optional, not built)

`mobile/ios` keeps a SwiftUI scaffold for a native client: pairing by QR scan or typed code, certificate pinning, a collection list with thumbnails, note editing, file sharing and photo upload, with one credential per paired computer in the Keychain. It needs an Xcode project created around it (see `mobile/ios/README.md`) and has not been compiled. The web client covers the same ground without the App Store; the native scaffold stays for anyone who wants pinning, offline caching or notifications later.

## Decisions and what is deferred

- **No background sync on the phone** and no push: the phone pulls when opened. Offline, it shows its last list and cached notes read-only.
- **No internet relay.** Phone access is LAN-only, like everything else. A later option could reuse a trusted computer as a relay over a VPN the user already runs; nothing here depends on cloud services.
- **Conflicts** follow the desktop rule: saving with a stale revision keeps both versions.
- **Not yet done:** building and testing the iOS app; a native Mac check of the service (it is platform-neutral Node code); mDNS or Bonjour discovery of computers from the phone (the QR carries addresses, which is enough for a first version); range requests for large downloads.
