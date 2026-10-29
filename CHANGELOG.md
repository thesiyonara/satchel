# Changelog

## Unreleased

### Changed
- The minimal Quick drop window is the same window at a third of the height: the same title bar with every button in the same place, the live pasteboard with Copy, Paste and Add files, and the two latest items as rows. The note composer is gone from it; the drawer offers Add files instead of Write a note.
- New note and Add sit side by side at the same weight on the main screen, and the empty collection offers files and the clipboard before a note.
- A profile still stored under the app's old name moves to the Satchel folder on start, so the app keeps nothing under the old name.

### Added
- The grid zooms: Ctrl/⌘ and the wheel, Ctrl/⌘ with + and − (0 for 100%), or the control at the top right of the collection, change how wide cards are, so more or fewer fit the window. The pinboard takes Ctrl/⌘ and the wheel too. Both are remembered per computer.
- The pasteboard column resizes: drag its left edge, use the arrow keys on it, or double-click it for the default width. Remembered per computer.

### Fixed
- Motion is one register throughout: the pasteboard column folds and unfolds with a transition, tiles, rows and clips come in the way cards do, hover controls fade instead of popping, and the grid re-flows smoothly when zooming.

## 0.6.13 — 2026-10-29

### Added
- A new note takes its first line as its name the moment it has one, so cards and files no longer read "Untitled note" with a code after it. A note that already has a name keeps it.

### Fixed
- A sender name stored by an older version with its ".local" suffix is shown without it.
- A card's menu opens downward when the card sits near the top of the window, instead of off the top edge.

## 0.6.12 — 2026-10-29

### Changed
- A paired computer is named without the ".local" that a Mac appends to its host name, everywhere its name shows: the sidebar, cards that arrived from it, the pasteboard and Quick drop.
- The pasteboard column header says "Live with" the paired computer by name, and keeps to one line. With one computer paired, the sidebar says that computer is offline rather than "paired computers".

## 0.6.11 — 2026-10-29

### Fixed
- Opening a note no longer squeezes the grid: the pasteboard column steps aside while a note is open and returns when it closes.

### Changed
- The pasteboard column says what is true: "Live on your other computer" once one is paired, "Syncs once a computer is paired" before. Its folded tab shows a dot when the text changed since it was folded. The text box no longer repeats what the header says.
- Quick drop: notes show their title rather than their file name, text tiles fade out at the bottom instead of cutting, tiles and rows can be reached with Tab and opened with Enter, and Escape puts the window away. The pasteboard line under the text reads once.
- Preferences: the note about updates is two sentences.

## 0.6.10 — 2026-10-29

### Changed
- Quick drop is built around the other computer. The live pasteboard sits on top of the window, with Copy, Paste and Add files in its corner, so typing or pasting there is on the other computer in a moment. Under it, Latest shows what is arriving with its progress, what came in from other computers and what went out from here, as square tiles or a list, with a switch next to the heading that is remembered per computer. Tiles show an image's thumbnail, a note's first lines or a file's type, and a dot marks what came in; Copy and Open appear on hover, and every tile or row drags out. The title bar names the connected computer. The note composer, the Recent and Favorites tabs, the intro text and the footer are gone from this window; the minimal window keeps its note composer, and the drawer keeps its pile. The dock buttons moved next to the opacity slider.

## 0.6.9 — 2026-10-29

### Changed
- The pasteboard is a column on the right of the main window instead of a view of its own, so the shared text is in sight while you work in the grid or on the pinboard. It folds to a tab on the edge, per computer, and the command palette's Open pasteboard shows it and puts the cursor in the text. The header says when the text last changed and from which computer.

### Added
- Recent, under the pasteboard text: when a text is pasted over or cleared, the old one lands there with its time and the computer it came from. Each entry can be copied, put back on the board (swapping with the current text) or removed, and the list can be cleared. Entries sync with the collection as small files, up to fifty, and never show as items.

## 0.6.8 — 2026-10-29

### Changed
- Updating is one click. The notice at the top of the window, and the button under Preferences, download the release, show the progress, verify it, save open notes and install, with no confirmation step in between. On Windows the installer now runs silently after Satchel quits and starts Satchel again. On a Mac, Satchel updates from the zip archive instead of the disk image: it unpacks the archive, swaps the fresh bundle in for the running one and relaunches, so there is no disk image to open and nothing to drag; when the swap is not possible, the unpacked app is shown in Finder with a message saying what to do.
- A failed download keeps the offer on the notice with a retry, and the message says what went wrong.

## 0.6.7 — 2026-10-29

### Added
- Pasteboard, in the sidebar next to Pinboard: one text area shared with every paired computer. Paste or type on one computer and it shows up on the others within seconds, in place, with Copy all and Clear. The latest change wins; the text lives in the collection's `.syncit` folder and never shows as an item.

## 0.6.6 — 2026-10-29

### Added
- An Add button next to New note on the main screen. It opens the system picker for files or for a folder, or pastes the clipboard, and the same entries are in the command palette. Files and folders you add or drop while looking at a folder land in that folder.

## 0.6.5 — 2026-10-28

### Changed
- Folders are browsed one level at a time. Everything shows the files at the top of the collection and a card for each folder, with its item count and a few of its images; opening a folder shows what is inside, and the path above the grid leads back up. Notes, Images, Files, Favorites, From other computers and search still look across every folder.
- Hidden files and folders are left out. A dropped folder is imported without the dot-named entries inside it (the logs, caches and tool files that sit beside real files), a hidden item dropped on its own is refused with a message, and hidden entries already in the collection are not listed.

### Fixed
- The screen-edge drawer acknowledges update preparation, so the Install button no longer times out waiting for a non-editor window. The handle pauses interactions during installation and resumes if preparation is cancelled.

## 0.6.3 — 2026-10-28

### Fixed
- The Apple silicon app starts its sync helper after installation. The helper is signed and checksum-verified before packaging, and the app signing step preserves those exact bytes.

### Added
- Mac releases verify the final app signature and helper checksum before creating installers, then run the packaged app to check helper startup. The release workflow requires both Mac and Windows package checks to pass.

### Changed
- Upgrading from 0.6.1 or 0.6.2 restores Mac sync without resetting the collection, settings, or existing pairings.

## 0.6.2 — 2026-10-28

### Added
- Incoming files are visible while they transfer. The grid shows a card for each file another computer is sending, with the sender, how much has arrived and a progress bar; the drawer lists the same; the sidebar reads "Receiving clip.mp4 · 4.2 MB/s"; the drawer handle carries a moving stripe; and the tray tooltip names the file. With arrival notifications on, a file over 10 MB is announced once when it starts to arrive. The two-computer test throttles the receiving side to watch a 24 MB transfer go through these states.

### Changed
- The sync engine reports progress every second instead of every two, runs at normal process priority instead of lowered, and allows more data in flight per transfer. Transfer speed on a local network is mostly set by Wi-Fi; these keep the app from adding to it.
- The README and the website explain how to open the unsigned installers on Windows and on macOS 15, where the right-click Open shortcut no longer works.

## 0.6.1 — 2026-10-27

### Added
- The website, in `site/`, published to GitHub Pages: what the app is, real screenshots, and download buttons that point at the latest release.
- "Open the drawer" in the tray menu, a line about the handle at the end of setup, and the Delete key asks to trash the current selection.

### Changed
- Releases carry each installer a second time under the old Sync-it name, so installs older than 0.5.0 still see updates. This bridge goes away in 0.7.

### Removed
- The unbuilt SwiftUI scaffold under `mobile/ios`. The phone is served by the desktop as a web client; a native app can start fresh from the Phone access API if ever wanted.

## 0.6.0 — 2026-10-27

### Added
- A selection does things now: Shift click selects a range, Ctrl/⌘ A selects everything in view, and the selection bar favorites, moves to a folder, trashes, or clears. Dragging any selected card still drags them all out.
- Folders inside the app: "Move to folder" on a card or a selection, with a new or existing folder name; top-level folders are listed in the sidebar and filter the grid.
- An optional system notification when a paired computer sends something, off by default, in Preferences. Clicking it opens the arrivals.
- The drawer handle sits on every display, and the drawer opens on the display the pointer is on.

### Changed
- In test mode the sync engine accepts loopback peers, so two instances on one machine can pair for the new two-computer test.

## 0.5.3 — 2026-10-27

### Changed
- Items in the drawer, and in Quick drop's Recent list, drag out into other apps, the same way cards drag out of the dashboard. Notes in the drawer show their title without the file extension.
- The drawer takes pasted text and screenshots too: a Paste button and a Write a note button sit under the drop target, Ctrl/⌘ V works once the drawer has focus, and the pile lists twelve recent items instead of eight.

## 0.5.2 — 2026-10-27

### Fixed
- The drawer shows the pile the first time it opens, when its window did not exist yet; before, that first open showed the full Quick drop window with the note composer.

## 0.5.1 — 2026-10-27

### Fixed
- The drawer opened from the command palette or the CLI waits up to twelve seconds for the pointer instead of closing at once; opened from the handle it still closes 1.5 seconds after the pointer leaves.

## 0.5.0 — 2026-10-27

### Added
- A drawer at the screen edge: a thin handle on the right, or the left, or off, in Preferences. Drag a file toward it and the drawer slides out as a pile of what is in the satchel; drop, and it closes by itself. Hovering opens it too, and the command palette has "Open the drawer".
- Several cards can be selected with Ctrl or ⌘ click and dragged out of the window together.
- Files that arrived from another computer in the last two days say so on their card, in the drawer, and under "From other computers" in the sidebar.

### Changed
- The app is now called Satchel, with a new mark: a block with a strap across it. Existing installs upgrade in place and keep their settings, pairings and collection folder. The GitHub repository moved to thesiyonara/satchel; the old address redirects.
- macOS packages are built for Apple silicon only; the Intel build is dropped for now.
- One plain description of the app in the package, the README and the GitHub repository, and a README introduction written as prose.

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
