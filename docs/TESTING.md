# Validation record and device acceptance

## Automated checks

- `npm test`: 16 tests covering path traversal and reserved paths; linked-folder rejection; duplicate import names and original preservation; stale editor revisions; delete/edit conflicts; board metadata validation and rename behavior; recoverable trash; missing roots; concurrent settings writes; pairing validation and internet-address rejection; simulated disk-full import cleanup.
- `npm run test:sync`: two paired, isolated Syncthing processes plus an unapproved third device. Checks runtime LAN/privacy configuration, mutual pairing, two-way notes, binary equality, shared placements, interruption and resumption of a throttled transfer, offline conflicts, deletion version history, identity preservation across restart, automatic helper-exit recovery, authenticated API rejection, TLS negotiation, third-device rejection, pause/resume, orphan shutdown with database-lock retry, revocation, and modified-helper rejection.
- `npm run test:ui`: real Electron windows. Onboarding, autosave, rename, imports, actual image thumbnails, text search, board drag, Quick drop, clipboard text/image capture, dark theme, inert HTML, denied external network access, blocked script launch, recovered draft journals, and uncaught renderer errors. Screenshots are in `test-results/`.

## Verified on the current Windows host

The source build, all 16 unit tests, two-engine integration test, and desktop UI flow have passed. The final packaged Windows executable also passed a startup check, including loading its verified bundled helper in an isolated profile, authenticated controls, ASAR integrity enforcement and all five configured Electron fuses. Renderer behavior is tested separately with development Electron because packaged debugging is disabled. The x64 NSIS installer has been built; interactive installation and login startup still require the acceptance checks below. The runtime dependency audit reported zero vulnerabilities.

In the integration run, a small note reached the peer in approximately 1.9 seconds after a forced scan. This is a same-host process test, not a physical Windows–Mac LAN measurement. Physical sleep/wake, low-disk-volume behavior, OS login startup, firewall permissions, and Mac execution remain hardware checks.

## Required physical Windows–Mac acceptance

These checks require a Mac and are not established by Windows-only testing:

1. Build/install the matching Mac architecture. Confirm first launch, local-network permission, helper execution, tray/menu bar, opening Finder, and thumbnail previews.
2. Install the Windows package. Pair the computers using the code and mutual ID approval. Test automatic local discovery and manual-IP fallback.
3. Disconnect internet access while preserving Wi-Fi/Ethernet LAN connectivity. Add a short note on either device; target arrival within five seconds on an established idle connection. Record actual network and device conditions.
4. Transfer an image, a nested directory, a file larger than available preview limits, and a large binary. Compare hashes.
5. Sleep and wake the Mac; disconnect/reconnect each computer. Edit both copies of a note offline, then reconnect and confirm both versions survive.
6. Interrupt a transfer; restart the app and confirm the final file matches. Terminate the helper and confirm supervised recovery without duplicate helpers.
7. Verify rename, removal, Trash/Recycle Bin recovery, received-version restoration, shared card drag/resize, independent zoom, and different screen sizes.
8. Remove access to the collection or temporarily move it. Confirm an actionable error and no silent folder recreation or deletion cascade. Use a disposable low-space volume to test write failure and retry.
9. Confirm startup at login (or manual Login Items setup for unsigned macOS builds), close-to-tray behavior, explicit quit, and shortcut registration conflicts.
10. Inspect network activity: sync traffic stays on the LAN; GUI/API binds to loopback; no discovery, relay, reporting, STUN, or update requests leave the machine.

Keep user files out of destructive failure tests. Use disposable collections and test volumes.

## Security review 0.1.1

All expanded automated suites passed on this Windows host. The latest small-note transfer took 1.856 seconds after a forced scan. The additional unit tests cover denied renderer origins, blocked executable types, Windows aliases, atomic creation collisions, failed-write cleanup, previous-note history and private-directory symlinks. See [security and recovery](SECURITY.md) for scope and limitations.

## 0.2.0 feature validation

On Windows, all 18 filesystem/security/control tests passed. The original desktop UI flow and the new six-feature flow passed. The new flow drives the real CLI to create/read/edit notes, import files, favorite and rename an item, place cards, pause/resume sync, take a screenshot, switch between quick/minimal windows, dock, set opacity and verify hiding on blur. It also exercises keyboard command-palette navigation and quick capture. Screenshots were visually inspected.

The real-engine integration suite passed again, including conflicts, interrupted transfers, unauthorized peers and orphan recovery. A small note transferred in 2.058 seconds after a forced scan on this host.

GitHub's first native build run did not start: its check annotations reported an account billing/spending-limit block. No Mac CI result exists. Fix the account billing settings before rerunning Desktop packages; local Windows checks do not establish Mac compatibility.

The final 0.2.0 packaged Windows executable passed fuse/integrity checks and its bundled CLI captured/read a note, opened/hidden the minimal panel, and quit cleanly with control credentials removed. Native DPI rounding is tolerated in window-size assertions.

## 0.2.1 update validation

All 22 unit/security/control/update tests passed. Update selection excludes downgrades, drafts, disabled previews, missing checksums and wrong architectures. Tests cover corrupted downloads, cleanup/retry, verification again before install, cancellation on quit and unsupported platforms.

The update UI test passed manual defaults, rendering, open-editor save acknowledgement, input freezing and cancel recovery. Existing UI and floating/CLI feature suites also passed. A live authenticated request selected the existing private v0.2.0 release using an isolated older-version test harness, downloaded its real Windows installer, and passed checksum verification twice. That installer was not executed.

Actual in-place replacement through the interactive Windows installer still needs a user-run acceptance check; tests do not claim a completed self-upgrade. Mac automatic installation remains unsupported until signed native releases exist. Daily checks are opt-in and downloads/installations are explicit.

The final packaged app passed the CLI smoke test and a live authenticated update check. The UI update handshake also rejected a save while its isolated collection was unavailable, retained the editor buffer, and saved successfully after restoring that folder.

## Phone web client 2026-10-27

`web/` is served by the Phone access service and `npm run test:web` drives it end to end: the real app serves the page over TLS, an isolated Chromium session (Electron's own, separate partition, trusting only the test host) opens the pairing URL, pairs, lists the collection, edits a note under the revision rule, creates a note, uploads a file, searches, fetches an original with the token, and unpairs. The unit suite checks that only the five client files are served without a token and that the pairing URL carries the one-time code. Not yet done on a real iPhone: the first-visit certificate warning and Add to Home Screen; those need a phone on the same Wi-Fi.

## Footprint check 2026-10-27

Measured with Electron's `app.getAppMetrics()` on a throwaway profile holding 40 notes: idle CPU 0.1% in the main process and 0 elsewhere, main-process heap 11 MB, total working set about 430 MB across Chromium's browser, GPU, utility and renderer processes (Syncthing runs as a separate child and is not included). Every timer, interval and listener in `electron/` and `src/` has a matching cleanup. Changes made for weight: status is pushed to windows only when it differs (0 pushes in 20 idle seconds, previously about 13), engine polling drops from 1.5 s to 10 s while all windows are hidden and resumes on show, Syncthing's full rescan is hourly, the library's own full rescan is every 10 minutes, and the editor journals drafts at most every 250 ms. Unit, update-UI and integration suites pass after the change.

## Public release preparation 2026-10-27

The updater now downloads directly from this repository's public GitHub releases (checksum file first, then the package, both restricted to `github.com/<owner>/<repo>/releases/download/`), with no GitHub CLI. `tests/updates.test.ts` was rewritten around an injected release client: selection rejects foreign download hosts, downloads fetch the checksum before the installer, corruption and tampering are rejected, HTTP 403/429/404, DNS failures, timeouts and cancellation map to actionable messages, and macOS selection and stale-download cleanup are unchanged. The repository slug lives only in `package.json` (`shared/project.ts` derives it). Added: a Checks workflow on every push, a draft-release job on version tags, CHANGELOG, CONTRIBUTING, a root SECURITY policy, issue and pull request templates, and `npm run screenshots` for the README images. The Everything heading no longer shows the full collection path.

## Phone access groundwork 2026-10-26 (unreleased)

The desktop now has an opt-in Phone access service (`electron/companion.ts`): local TLS certificate with fingerprint pinning, QR/code pairing, hashed bearer tokens, and a JSON API for items, notes, files, thumbnails and uploads. `tests/companion.test.ts` covers certificate generation and the served fingerprint, the 401 before pairing, five wrong codes closing the window, single-use codes, token hashing on disk, every endpoint, path containment, unknown tokens, self-unpairing and revocation. The UI suite enables the service in the live app, pairs over loopback with the code shown in the pairing panel, reads the collection with the token and removes the phone.

## Design and feature round 2026-10-26 (unreleased)

Changes: code-free pairing from a Nearby list (Syncthing's discovery cache) with automatic collection-ID convergence; any number of paired computers; untrusted devices that receive only encrypted data; note History with restore (local copies follow app renames); read-only Markdown preview from a parsed tree; folder chips and folder-aware search; tray Capture clipboard and Pause/Resume; an incremental library index with a five-minute full rescan; onboarding with folder choice and opt-in login/shortcut; one vocabulary and no slogans across the dashboard, Quick drop, palette, settings and onboarding.

Verified on this Windows host: typecheck clean; 29 unit tests pass (new: Markdown parser inertness, note history and its path validation, index updates from external writes, address and encryption-password validation); the two-engine integration suite passes in 74 s and now also covers approving a third device as encrypted-only (it never receives readable files), revoking it, pairing a fresh computer by device ID without a code, both sides converging on the smaller collection ID, and a transfer afterwards; `test:features` and `test:updates` pass; `test:ui` passes with the clipboard steps skipped because the Windows clipboard was unavailable in this session (a locked or remote desktop makes Electron clipboard writes no-ops). The suite now reports that skip instead of failing. Clipboard capture therefore remains verified only by the earlier 0.2.x runs. Import sources in the UI suites were moved out of the app profile, since private app storage is now refused as an import source. Screenshots of the revised screens are in `test-results/`.

Not verified: any run on a Mac, discovery between two physical computers (the Nearby list was checked against Syncthing's `/system/discovery` output on this host, which listed the running desktop app), and the untrusted-device flow against a real receive-encrypted Syncthing folder.

## Audit and fixes 2026-10-26

An independent code audit ([record](AUDIT-2026-10-26.md)) found that every macOS bundle shipped a FreeBSD rc script in place of Syncthing, with runtime pins recorded from that script. The fetch script now extracts the exact top-level executable, validates its header, and fails on a pin mismatch; both darwin pins were regenerated from the real Mach-O binaries. Further fixes: absolute System32 paths for `whoami`/`icacls`, OpenDocument formats removed from the launch allowlist, private app storage excluded from imports, stale update downloads removed at startup, actionable GitHub CLI errors, note-history and thumbnail retention, a create-if-absent fallback for volumes without hard links, engine restart budget recovery, case-insensitive orphan path comparison, favorites cleanup on trash, SHA-pinned CI actions, and a 404 instead of an unhandled error for malformed app URLs. In-app updates now also cover macOS disk images.

Verified on this Windows host after the fixes: typecheck clean; 25 unit/security/control/update tests pass (new: hard-link fallback and name truncation, bounded note recovery, macOS release selection/verification, stale-download cleanup, GitHub CLI error mapping); the two-engine integration suite passes. The packaged 0.2.1 build was also launched with `--remote-debugging-port` in throwaway profiles and never opened the port. Still unverified: the Electron UI suites after these changes, any execution on a Mac, and the Mac update flow on real hardware. The Mac acceptance checklist above remains required before claiming Windows–Mac support.

## Incoming transfers

The engine reads Syncthing's need list and its DownloadProgress events and publishes them as `incoming` on the sync status, with the bytes-per-second received between two polls as `inRate`. `npm run test:pair` starts the receiving instance with `SYNCIT_TEST_RECV_KBPS=3000`, a test-only throttle that makes Syncthing cap what it receives on the loopback link, then sends a 24 MB file and checks the arriving card with its sender, the sidebar line, the recorded notification, a non-zero progress value, the file landing marked as from the laptop, and the card going away.

## Folders and hidden entries

Everything browses one level at a time; the UI suite moves every item into a folder, checks that the top level then shows only the folder card with its count, opens it, finds the folder path above the grid, and moves the items back. `tests/core.test.ts` imports a folder holding a hidden `.paircut` tree and a `.DS_Store` and checks that only the real file is copied and listed, that a hidden item dropped on its own is refused, and that hidden entries already in the collection stay out of the listing.

## Pasteboard

The pasteboard is `.syncit/pasteboard.txt` in the collection: synced like the pinboard placements, never listed, replaced whole on every save and read back with each snapshot. The UI suite types into it, reads it back through `list()`, and clears it. `npm run test:pair` types on the laptop instance and waits for the same text to appear in the desk instance's open pasteboard without a reload (screenshot `test-results/pair-pasteboard.png`). A unit test covers the empty state, the 1 MB limit and that the file never appears as an item.
