# Updates

Satchel updates itself from this project's GitHub releases. No account, token or extra tool is involved; the app never installs anything without your click.

## In the app

Open **Preferences → App updates**:

1. **Check for updates** asks GitHub's public releases API for the newest version that is newer than the installed one and ships a package for this computer: a Windows installer (`Satchel-VERSION-win-ARCH.exe`) or a macOS disk image (`Satchel-VERSION-mac-ARCH.dmg`).
2. **Download update** fetches the release's `SHA256SUMS-VERSION.txt` first, then the package, both over HTTPS from `github.com/<owner>/<repo>/releases/download/`, and verifies the package against the checksum file.
3. **Install update → Save notes & install** saves open note editors, stops syncing, verifies the file again, opens it, and quits Satchel. On Windows, finish the normal installer and use its launch option. On a Mac, the disk image opens in Finder: drag Satchel to Applications, replace the existing app, then open it.

You can postpone installation and keep working. A download is held only for the current app session; failed downloads are removed immediately, and downloads left by earlier sessions are deleted at the next start. Collection files and preferences stay where they are after updating.

**Check daily for updates** is optional and off by default. When on, the app checks after startup and roughly daily while running. Internet failures never affect LAN sync. **Include preview releases** is also off by default; turn it on to receive releases marked as pre-release on GitHub.

The app never downgrades, ignores draft releases, and treats a release without a matching package and checksum file as not installable. Download URLs must belong to this repository's release downloads; anything else is refused. Checksum verification detects corruption and substitution relative to the published release; it does not replace code signing, so the operating system may still warn about the publisher (see the README).

## Command line

```sh
node scripts/syncit.mjs update status
node scripts/syncit.mjs update check
node scripts/syncit.mjs update download
node scripts/syncit.mjs update install
```

`update install` performs the same save, stop, verify and open sequence. It works only in a packaged Windows or macOS app.

## Publishing a release

See [RELEASING.md](RELEASING.md). In short: bump the version, update the changelog, push a `vX.Y.Z` tag, let the Desktop packages workflow build both platforms and attach the installers plus `SHA256SUMS-X.Y.Z.txt` to a draft release, then review and publish it. The updater only needs those assets to exist with the expected names.
