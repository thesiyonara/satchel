# Updates

Satchel updates itself from this project's GitHub releases. No account, token or extra tool is involved; nothing is downloaded or installed without your click, and only a download verified against the release's published checksums is ever installed.

## In the app

Open **Preferences → App updates**:

1. **Check for updates** asks GitHub's public releases API for the newest version that is newer than the installed one and ships a package for this computer: a Windows installer (`Satchel-VERSION-win-ARCH.exe`) or a macOS archive (`Satchel-VERSION-mac-ARCH.zip`).
2. **Update to VERSION**, there or on the notice at the top of the main window, does the rest in one go. It fetches the release's `SHA256SUMS-VERSION.txt` first, then the package, both over HTTPS from `github.com/<owner>/<repo>/releases/download/`, shows the download's progress, verifies the package against the checksum file, saves open note editors, stops syncing, verifies the file again and installs:
   - On Windows the installer runs silently after Satchel quits, then starts Satchel again from the same place.
   - On a Mac the archive is unpacked with `ditto`, the fresh bundle is swapped in for the running one, the old bundle is parked in the app's private updates folder until the next start, and Satchel relaunches. If the swap is not possible (Satchel runs from a disk image or another temporary location, or Applications is not writable), nothing is changed, the unpacked app is shown in Finder, and a message says to drag it to Applications.

If a download fails, the notice offers a retry. A download is held only for the current app session; failed downloads are removed immediately, and downloads left by earlier sessions are deleted at the next start. Collection files and preferences stay where they are after updating.

**Check daily for updates** is optional and off by default. When on, the app checks after startup and roughly daily while running. Internet failures never affect LAN sync. **Include preview releases** is also off by default; turn it on to receive releases marked as pre-release on GitHub.

The app never downgrades, ignores draft releases, and treats a release without a matching package and checksum file as not installable. Download URLs must belong to this repository's release downloads; anything else is refused. Checksum verification detects corruption and substitution relative to the published release; it does not replace code signing, so the operating system may still warn about the publisher (see the README).

## Command line

```sh
node scripts/syncit.mjs update status
node scripts/syncit.mjs update check
node scripts/syncit.mjs update download
node scripts/syncit.mjs update install
node scripts/syncit.mjs update now
```

`update install` performs the same save, stop, verify and install sequence on a verified download; `update now` checks, downloads and installs in one go. Both work only in a packaged Windows or macOS app.

## Publishing a release

See [RELEASING.md](RELEASING.md). In short: bump the version, update the changelog, push a `vX.Y.Z` tag, let the Desktop packages workflow build both platforms and attach the installers plus `SHA256SUMS-X.Y.Z.txt` to a draft release, then review and publish it. The updater only needs those assets to exist with the expected names.
