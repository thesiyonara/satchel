# Satchel

One shared folder for all your computers. It syncs over your own network, not the internet.

[![Checks](https://github.com/thesiyonara/satchel/actions/workflows/ci.yml/badge.svg)](https://github.com/thesiyonara/satchel/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/thesiyonara/satchel?display_name=tag)](https://github.com/thesiyonara/satchel/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-informational)](LICENSE)

[Website](https://thesiyonara.github.io/satchel/) · [Download the latest release](https://github.com/thesiyonara/satchel/releases/latest)

![The dashboard: a grid of notes and files with the collection and connection state in the sidebar](docs/screenshots/dashboard.png)

## What it is

Satchel is a desktop app for Windows and macOS. You get one folder on each of your computers, and the app keeps those folders the same. Changes travel straight from one computer to the other over your own network, never through a server. On top of that folder the app gives you a searchable grid, a shared pinboard, a note editor with history, and a small floating window for dropping things in quickly.

Files stay ordinary files on your disk, so any other program can use them. There is no account, no relay and no telemetry. Computers find each other on the network and you confirm each pairing yourself; the bundled [Syncthing](https://syncthing.net) engine encrypts every transfer. The interface shows only real state: what is paired, what is syncing, what conflicted.

## Features

- Grid of notes, images, videos, audio and files with folder context, search over names, folders and note text, and filters for favorites and conflicts.
- Previews inside the app: images (including iPhone HEIC and TIFF through the operating system's renderer), video and audio with seeking, PDFs, and text-like files. Office documents and archives open in their default app.
- Note editor with autosave, read-only Markdown preview, and **History** to preview and restore earlier versions, including versions archived from received changes.
- Shared pinboard: card positions sync; zoom stays local.
- Quick drop: a floating window (Ctrl/⌘ Shift Space) to write a note, paste a screenshot or drop files from anywhere. A thin handle at the screen edge is the drawer: drag a file toward it and it slides out, drop, and it closes by itself.
- A file on its way from another computer shows up before it lands: a card with the sender, the size and a progress bar, the same line in the drawer, the transfer speed in the sidebar, and a moving stripe on the drawer handle. Once there, it says where it came from on its card, in the drawer, and in the sidebar for two days. System notifications for arrivals, and for large files when they start to arrive, can be turned on in Preferences.
- Select several cards with Ctrl/⌘ or Shift click, or Ctrl/⌘ A, then favorite, move to a folder, trash or drag them out together. Folders are ordinary folders in the collection: a dropped folder stays a folder, shows as a card you open to see what is inside, and the path above the grid leads back up. The filters and search look across every folder.
- Hidden files and folders, the dot-named ones tools leave beside real files, are not imported and never listed.
- Pairing without a code from a Nearby list, or with a code or device ID when discovery is blocked. Any number of computers; each can be revoked.
- Untrusted devices: give a NAS an encryption password and it holds an encrypted copy it cannot read.
- Conflicts keep both versions. Deleted files go to the Recycle Bin or Trash, and received overwrites keep 30 days of versions.
- Tray menu, command palette, and an authenticated local CLI for scripting.
- Phone access: turn it on in Preferences and scan the QR code with your phone's camera. The browser opens a small app served by your computer over your network: browse, read and edit notes, download files on demand, upload photos. Add it to the Home Screen; nothing is stored on the phone.
- In-app updates, downloaded from this repository's releases and verified against published checksums.

| Pinboard | Note with Markdown preview | Quick drop |
| --- | --- | --- |
| ![Pinboard](docs/screenshots/pinboard.png) | ![Note](docs/screenshots/note.png) | ![Quick drop](docs/screenshots/quick-drop.png) |

## Install

Download the package for your computer from the [latest release](https://github.com/thesiyonara/satchel/releases/latest):

- **Windows 10 or 11:** `Satchel-X.Y.Z-win-x64.exe`, a normal installer.
- **macOS 13 or newer on Apple silicon:** `Satchel-X.Y.Z-mac-arm64.dmg`. Drag Satchel to Applications. Intel Macs are not built for yet.

Builds are not yet signed with a developer identity, so Windows SmartScreen and macOS Gatekeeper warn on first launch. On Windows choose **More info → Run anyway**. On macOS, open the app once so it is refused, then go to System Settings → Privacy & Security and choose **Open Anyway**; since macOS 15 the right-click Open shortcut no longer works for unsigned apps. The app's own updater checks later versions against their checksums, so the warning appears only on the first install. Every release ships a `SHA256SUMS-X.Y.Z.txt` you can check the download against.

On first launch, choose the collection folder (`~/Satchel` by default) and whether to start at login.

## Pair your computers

1. Install and set up Satchel on each computer, on the same network.
2. On one computer open **Computers & sync**. The other computer appears under **Nearby** with its device ID. Compare the ID with the one shown on that computer, then **Connect**.
3. On the other computer, **Approve** the request. Both computers adopt one collection ID; existing files are merged, never deleted.

If discovery is blocked, use **Pair with a code or device ID**: copy a pairing code on one computer and paste it on the other, or enter the device ID and local IPv4 address. Allow the app through the firewall on private networks: TCP **22027** for transfers, UDP **21027** for discovery. Guest Wi-Fi and client isolation prevent direct connections.

![Computers & sync with the Nearby list and this computer's device ID](docs/screenshots/computers.png)

## Everyday use

- Add on the main screen, next to New note, opens the system picker for files or for a folder; what you pick lands in the folder you are looking at, or at the top of the collection. Drop files or folders into the dashboard, into Quick drop, or straight into the collection folder with Explorer or Finder. App imports copy the original. Drag a card out of the dashboard to hand the file to another app.
- Paste text or a screenshot to create a note or a PNG. The clipboard is read only when you paste.
- Notes autosave. Plain text and Markdown up to 1 MB open in the editor; larger files open in their default app.
- Pin cards from a card's menu or from the strip under the pinboard. Drag the handle to move, the corner to resize.
- Closing the dashboard keeps syncing from the tray or menu bar; **Quit** stops it.

The app does not encrypt files on disk; use your operating system's disk encryption. Sync is not a backup: a deletion propagates. Received overwrites and deletions keep 30 days of versions under **Preferences → File recovery**.

## Updates

**Preferences → App updates** checks this repository's releases, downloads the package and the release's checksum file, verifies the download, and opens the installer only when you ask. Daily checks are opt-in. Details in [docs/UPDATES.md](docs/UPDATES.md).

## Security

Loopback-only engine controls, private app storage with restrictive permissions, a sandboxed renderer with a deny-by-default network policy, pinned helper hashes, Electron fuses, and path containment on every file operation. The model, the hardening and the known limits are described in [docs/SECURITY.md](docs/SECURITY.md); report vulnerabilities through [SECURITY.md](SECURITY.md).

## Development

Node.js 24 on Windows 10+ or macOS 13+.

```sh
npm ci
node node_modules/electron/install.js
npm run fetch:engine
npm run dev
```

```sh
npm run typecheck
npm test              # unit, security, control, updates, Markdown, phone access
npm run test:sync     # two real Syncthing engines on loopback
npm run test:ui       # Electron UI flows; opens windows
npm run screenshots   # regenerates docs/screenshots from a throwaway profile
```

Packaging: `npm run dist:win` on Windows, `npm run dist:mac` on a Mac (`bash scripts/build-mac.sh` also verifies the bundle). `npm run fetch:engine` downloads the pinned Syncthing release, extracts the exact executable, checks its header and fails if `shared/engine-integrity.json` disagrees. Releases are built by GitHub Actions from a `vX.Y.Z` tag; see [docs/RELEASING.md](docs/RELEASING.md).

Layout: `electron/` is the main process (files, settings, Syncthing supervision, IPC, windows, tray, phone access, updates); `src/` the React renderer; `shared/` the typed bridge; `scripts/` build, release and test drivers; `site/` the website; `docs/` the design, security, testing, CLI, updates and phone notes.

Contributions are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md) first. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

Development credits, including OpenAI Codex and Anthropic Claude, are in [CONTRIBUTORS.md](CONTRIBUTORS.md).

## License

MIT. Syncthing is bundled unmodified under the MPL-2.0; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
