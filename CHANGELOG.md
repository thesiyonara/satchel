# Changelog

## 0.4.10 — 2026-10-27

### Fixed
- Nothing is cut off any more: file cards keep name and size on their own lines, the search placeholder trims with an ellipsis in narrow windows, the minimal Quick drop window no longer clips its tool row, and the phone page uses one column on narrow phones. Checked with an overflow audit at three window sizes, with long names, across the grid, the note pane with history, the pinboard, Preferences, the palette and both Quick drop modes.

## 0.4.9 — 2026-10-27

### Changed
- A polish pass on the new design: one motion system across the app and the phone page (cards and views rise in, dialogs and menus settle, thumbnails fade in once loaded, buttons respond at once, nothing bounces, and all of it is off under reduced motion), the note pane no longer repeats the title in its label, Quick drop's docking buttons sit with the other tools, and leftover code from the old chrome is gone.

## 0.4.8 — 2026-10-27

### Changed
- A new look for the desktop app, Quick drop and the phone page: content first. The collection starts at the top of the window under a search field; the page heading, subtitle, hint bars and drop box are gone. A rail of plain words replaces the icon sidebar, with the sync state once at its foot. Cards are sized by their content in a masonry layout: notes show their text, images keep their own aspect ratio, files are compact rows. One bundled typeface, Instrument Sans, carries the hierarchy, in sentence case throughout. The app follows the system light or dark setting by default; orange is used only for selection and attention.

## 0.4.7 — 2026-10-27

### Added
- Drag a card out of the window to hand the file to Explorer, Finder or another app, with its thumbnail as the drag image. Dropping it back onto Sync it does nothing but say the file is already in the collection.

## 0.4.6 — 2026-10-27

### Fixed
- Dragging something that is already in the window, such as a thumbnail or a card, no longer creates a note holding the app's own media link or imports anything. Thumbnails are not draggable, and drops that start inside the window are ignored.

## 0.4.5 — 2026-10-27

### Changed
- Notes open in a pane beside the collection instead of a dialog over it, so the grid stays in view, the open card is marked, and switching notes is one click. The pane saves on close or switch, including unsaved text.
- Card previews show the note's text without Markdown syntax (no asterisks or quote markers), in the grid, on the pinboard and on the phone page. A note's leading heading is no longer rendered twice in the editor.
- The main window says each thing once: search moved to the top bar in place of the breadcrumb, the sync pill appears only for a pairing request or a problem, and the sidebar card and status bar carry the sync state.
- The dialog opened from the sidebar is called Preferences everywhere, with the tabs Computers & sync and General.
- Quick drop: a quieter headline, docking buttons grouped, and a labelled Dashboard button. Favorites get a proper empty state.

## 0.4.4 — 2026-10-27

### Changed
- The phone page got a proper design: a two-column card grid where notes read like index cards with their first lines, photos and videos fill their squares with a gradient caption, and other files show their type; a floating + button with a sheet for New note and Add photo or file; a full-bleed viewer for photos and videos; and a Share button on iPhone that hands a file to the system share sheet. Lists load with a shimmer, screens animate in, and the dark and light palettes match the desktop app.

## 0.4.3 — 2026-10-27

### Fixed
- Phone page: long titles and file names no longer push the page sideways; titles wrap to two lines, previews are cut with an ellipsis, and the note editor fills the screen and grows with the text instead of scrolling inside a box.

## 0.4.2 — 2026-10-27

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
