# Security and recovery — 0.1.1

## Apple silicon helper signing

The upstream archive and untouched executable are checked against their original SHA-256 pins first. On Apple silicon, `fetch-engine.mjs` then ad-hoc signs the freshly extracted helper with the fixed identifier `local.syncit.syncthing` and no timestamp, verifies its signature, and checks its complete signed-file hash against `shared/engine-signed-integrity.json`. The runtime requires that signed pin; it does not accept arbitrary signatures or skip the hash check. The app packager leaves this already signed helper unchanged. An after-sign hook checks the final helper hash and the complete app signature before creating installers, and the Mac release job runs the packaged startup test.

When upgrading Syncthing, update the upstream pins using the existing reviewed process, then review and update the signed helper pin on a Mac. Always sign freshly extracted upstream bytes; re-signing an already modified Mach-O can produce different bytes. A different signing output fails the build until its pin is reviewed.

## Phone access (unreleased groundwork)

Off by default. When on, the app serves an HTTPS API on port 22028 to the attached IPv4 networks only. The certificate is generated locally (EC P-256) and stored in private app storage; the phone pins its SHA-256 fingerprint from the pairing QR code, so neither an authority nor the network is trusted. Pairing is a five-minute, single-use window with an eight-character code and at most five attempts; the phone receives a 256-bit bearer token of which only the hash is stored (`phone-devices.json`). Paired phones are listed and revocable, and a phone can unpair itself. Requests use the same path containment as the desktop, so private app data, `.syncit` and `.stversions` stay unreachable. Uploads are limited to 100 MB and JSON bodies to 2 MB. A paired phone can read the entire collection and add or edit notes and files; treat pairing like handing over the collection, and remove lost phones. Nothing leaves the local network. See [MOBILE.md](MOBILE.md).

## Pairing, multiple computers and untrusted devices (unreleased)

- **Nearby list.** The app reads Syncthing's local-discovery cache and lists unpaired devices with their full ID. Connecting adds that device and shares the collection; it still has to approve this computer. Always compare the full ID with the one displayed on the other computer: discovery announcements are not authenticated, only the TLS connection that follows is.
- **Collection ID convergence.** Two computers that pair without a code each offer their folder; both adopt the lexicographically smaller ID. Only the ID changes; the folder path and files stay in place. A device that is not paired cannot trigger this.
- **Several computers.** The single-peer limit is gone. Each paired device is listed and revocable on its own. Pause applies to all of them.
- **Untrusted devices.** A device approved or connected with an encryption password receives only encrypted file data (Syncthing's untrusted-device mode). It cannot read file names or contents, and every trusted computer must configure the same password for it. A plain Satchel installation cannot act as the untrusted side; use a NAS or server running Syncthing with a receive-encrypted folder. The password is stored in this computer's private engine configuration.
- **Note history** reads only from the private note-history directory and the collection's `.stversions` archive; version IDs are validated and resolved inside those two locations.
- **Markdown preview** renders a parsed tree with React; it never injects HTML, follows links or loads images.

## Hardening after the 2026-10-26 audit (unreleased)

See [the audit record](AUDIT-2026-10-26.md) for findings and verification. Changes since 0.2.1:

- **macOS engine:** `scripts/fetch-engine.mjs` previously extracted `etc/freebsd-rc/syncthing` (a shell script) instead of the Syncthing binary for macOS, and the darwin runtime pins recorded that script's hash. The script now extracts only the archive's top-level executable, checks its Mach-O/PE header and size, and fails when `shared/engine-integrity.json` disagrees. The darwin pins were regenerated from the real binaries. The engine supervisor also restores the execute bit on a verified helper if packaging dropped it.
- **System tools by absolute path:** private-storage protection on Windows runs `whoami.exe` and `icacls.exe` from `%SystemRoot%\System32`, so PATH order or a planted binary cannot substitute them.
- **Launch allowlist:** OpenDocument formats (`.odt`, `.ods`, `.odp`) can embed macros and are no longer launched from the dashboard; use **Show in folder**.
- **Imports:** paths inside private application storage (engine keys, settings, the control secret) are refused, so they cannot be copied into the synced collection.
- **Update downloads:** installers verified by an earlier session are deleted at startup; only the current session's verified download can be installed. GitHub CLI failures now distinguish not-signed-in, not-found, refused and unreachable.
- **Disk use:** local note history keeps the newest 20 previous versions per note and drops versions older than 30 days; thumbnails unused for 30 days are removed at startup.
- **Volumes without hard links:** create-if-absent writes (new notes, pasted images, imports) fall back to an exclusive claim plus rename on exFAT, FAT32 and similar volumes instead of failing.
- **Supervision:** the engine restart budget is restored after a minute of healthy running; orphan-helper detection compares paths case-insensitively on Windows; favorites are removed when their item is trashed.
- **macOS packaging:** bundles are ad-hoc signed with hardened runtime off (electron-builder skips signing entirely for `identity: null`, and Apple Silicon refuses to launch a repackaged bundle without a signature). `scripts/build-mac.sh` verifies the signature and that the bundled helper still matches its runtime pin.
- **CI:** GitHub Actions are pinned to commit SHAs.

## Updates: the one exception to offline operation

Explicit update checks and downloads, or optional daily checks (off by default), contact GitHub's public releases API and release downloads over HTTPS. No credentials are involved. The app only accepts download URLs under this repository's release downloads, fetches the release's checksum file first, verifies the package against it, and verifies again before opening it. This detects corruption and substitution relative to the published release, not compromise of the publishing account; code signing is the remaining gap. Open editors must save successfully before hand-off, and the installer or disk image is opened interactively, never silently. See [update details](UPDATES.md).

## 0.2.0 local automation addition

The app now exposes authenticated loopback control for the CLI. The secret lives in the protected app profile and rotates each launch. Browser origins, unexpected Host headers and unknown commands are rejected; no execution/debugging endpoint is provided. This intentionally enables the current account to automate UI capabilities, including clipboard capture, pairing and deletion. See [CLI boundaries](CLI.md). Quick capture drafts and favorites stay local; drafts remain plaintext in the protected profile. Prior protections below remain in place.

This is a hardened personal-use build, not a claim that the app is unhackable or independently penetration-tested.

## Network observers

Syncthing authenticates paired device certificates and encrypts transfers with TLS. Capturing network traffic should not reveal file contents. Compare the entire requesting device ID against your other computer before approving it; never approve an unfamiliar request or accept an untrusted pairing code.

Global discovery, relays, NAT traversal, STUN, telemetry, crash reporting and automatic updates are disabled before launch. Peers are restricted to directly attached IPv4 subnets. VPN/virtual interfaces count as attached interfaces; network restriction does not replace authentication or your firewall.

Local discovery announces a device ID and listening port. Disable **Automatic device discovery** to suppress announcements, and use a manual local IPv4 when pairing. Update that address if it changes. Encryption does not conceal connection timing, traffic volume or which computers communicate. **Pause all sync** stops transfers but does not disable discovery announcements. **Revoke access** stops future sharing, but cannot erase files already copied.

## Hardened boundaries

- Loopback-only controls require a fresh random API key. GUI login uses a random bcrypt-protected password. Unauthenticated configuration, status and metrics requests are rejected; the public login shell contains no API key.
- App-owned storage receives restrictive OS permissions, outside the collection. Windows inherited grants are removed; current-account and SYSTEM access are granted. Unusual pre-existing explicit ACLs need separate review.
- The renderer is sandboxed and context-isolated without Node access. IPC callers and paths are checked. Traversal, reserved paths, Windows aliases and linked-path escapes are rejected.
- Renderer requests default to denied, including internet and loopback API access. Notes are inert text, without executable HTML or remote images.
- Scripts, installers, shortcuts, active web documents, macro-capable office formats (`.docm`, `.xlsm`, `.odt`, `.ods`, `.odp`) and unknown types cannot launch from the dashboard. Use **Show in folder** to inspect them. Allowed documents still rely on the security of their OS-associated viewers.
- Image previews have byte and dimension limits. This is not an antivirus scanner.
- Official helper archives and the extracted executable are SHA-256 checked against pinned hashes. The fetch script extracts only the archive's top-level executable, checks its PE/Mach-O header, and fails when the runtime pin disagrees. Modified helpers are refused at launch.
- Packaged Electron disables RunAsNode, NODE_OPTIONS and Node debugging, enables ASAR integrity checking and ASAR-only loading, and disables production devtools.

## Recovery

Atomic note writes preserve existing files when writes fail. New files use non-overwriting creation; failed writes remove temporary files. Stale editor revisions preserve conflict copies, and incoming changes do not overwrite unsaved buffers.

Unsaved drafts are journaled locally and recovered as separate notes after restart. OS/browser storage failure can still lose recent keystrokes. **Preferences → Open previous note history** contains previous local note contents; received changes have separate 30-day Syncthing version history. Local note history keeps the newest 20 previous versions per note and removes versions older than 30 days; back up anything you need to keep longer.

Helper exits are supervised. Orphan recovery authenticates the old helper and verifies its profile before requesting shutdown. Startup retries database-lock release races without killing unknown processes. Missing collection folders remain errors rather than being silently recreated. Disk-full failures surface as errors. Sync is not a backup.

## Limits and remaining validation

Files, drafts and history are plaintext on disk. Malware or an administrator on a trusted computer can access files and credentials. OS disk encryption and account protection are needed for loss/theft protection. Keep operating systems and viewers updated.

Personal installers are unsigned and do not establish publisher authenticity. Use trusted distribution and compare hashes separately. Updates are manual; security fixes require rebuilding and installing a new release. Dependency audits are point-in-time checks, not proof of safety. No independent penetration test was performed.

See [the validation record](TESTING.md). macOS execution, a physical Windows–Mac LAN pair, sleep/wake, interactive installation, login startup and a real low-disk-volume test remain unverified on this Windows host.

References: [Syncthing security](https://docs.syncthing.net/users/security.html), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses).
