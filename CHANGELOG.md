# Changelog

## Unreleased

### Added
- Previews inside the app and on the phone for the common media types: images including iPhone HEIC and TIFF (rendered by the operating system when the browser engine cannot decode them), video and audio streamed from the collection with seeking, PDF through the built-in viewer, and text-like files (CSV, JSON, code, logs) as read-only text. Videos and PDFs get thumbnails. When a format cannot be decoded, the viewer says so and offers the default app.
- The phone page was redesigned: filter chips with counts, a photo and video grid, viewers for images, video, audio, PDF and text, the note editor, and a Computer screen for status and unpairing.
- The Quick drop window has its own opacity control in its title bar.

## 0.4.1 — 2026-10-27

### Added
- Phone access serves a web app: scanning the pairing QR code opens the collection in the phone's browser, pairs it, and offers listing, search, note editing, new notes, photo upload, file download and unpair. Add to Home Screen for an icon. `npm run test:web` covers it end to end.

### Fixed
- Changing the device name or sync toggles before the sync engine has started no longer fails; the engine applies the stored settings when it starts.

## 0.4.0

Initial clean public baseline.

### Included

- Local-network file sync between paired computers, with a normal collection folder.
- Notes, image previews, Markdown preview, note history and conflict recovery.
- Shared pinboard, favorites, command palette and compact floating capture window.
- Authenticated local CLI and optional paired-phone access groundwork.
- Direct checksum-verified release downloads without GitHub sign-in.
- Sandboxed rendering, restricted file operations and a pinned sync helper.

### Public release hygiene

- Source-only initial history and neutral project contributor identity.
- Sample screenshots use neutral device/network values.
- Installers exclude source maps and logs; source kits use a tracked-file manifest.
- Release preparation includes a privacy scan.
