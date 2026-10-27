# Releasing

Releases are tagged `vX.Y.Z`, built by GitHub Actions on Windows and macOS, and published from a draft so a human looks at them first. The in-app updater reads the published release and expects the asset names below, so keep them.

## Checklist

1. **Changelog.** Move the entries under `Unreleased` in [CHANGELOG.md](../CHANGELOG.md) to a new `X.Y.Z — YYYY-MM-DD` section. Keep the three headings: Added, Changed, Fixed. Mention anything users must do after updating.
2. **Version.** Set `version` in `package.json` to `X.Y.Z` (numeric only; the updater ignores other tags). Commit with `Release X.Y.Z`.
3. **Checks.** `npm test`, `npm run test:sync`, and on Windows `npm run test:ui`, `npm run test:features`, `npm run test:updates`. CI runs the first two on every push.
4. **Tag and push.**

   ```sh
   git tag vX.Y.Z
   git push origin master vX.Y.Z
   ```

5. **Wait for Desktop packages.** The workflow packages the Windows installer and the macOS DMG/ZIP for both architectures, runs the packaged smoke test on Windows, computes `SHA256SUMS-X.Y.Z.txt`, and creates a **draft** release with generated notes. If a release for the tag already exists, it adds only the packages that are missing and extends the checksum file; assets already on the release are never replaced (`scripts/ci-release.sh`).
6. **Review the draft.** Replace the generated notes with the changelog section, mark it as a pre-release if it is a preview (the app only offers pre-releases to users who opted in), and publish. Do not rename assets.
7. **Verify** by opening Preferences → App updates on an older installation and checking that the new version is offered and installs.

## Assets the updater needs

| Asset | Built by |
| --- | --- |
| `Satchel-X.Y.Z-win-x64.exe` | `npm run dist:win` on Windows |
| `Satchel-X.Y.Z-mac-arm64.dmg` (plus `.zip`) | `npm run dist:mac` on macOS; Apple silicon only for now |
| `SHA256SUMS-X.Y.Z.txt` | CI, or `node scripts/release.mjs` locally |

Never overwrite a published tag with different bytes; publish a new patch version instead.

The `dist:*` scripts pass `--publish never` to electron-builder: on a version tag it would otherwise try to publish the packages itself and fail without a token. Publishing is the workflow's release job or `scripts/release.mjs --publish`, nothing else.

## Local alternative

`npm run dist:win` or `npm run dist:mac`, then `node scripts/release.mjs` to write the checksum file, then `node scripts/release.mjs --publish --notes PATH [--preview] [--draft]`, which uses the GitHub CLI with your own login. This is for maintainers who cannot use Actions; the result must have the same asset names. Pushing the tag afterwards still runs the workflow, which then attaches the packages the local publish did not build, typically the macOS ones.

## Signing

Builds currently carry no developer identity: Windows SmartScreen and macOS Gatekeeper will warn on first launch. Adding a Windows code-signing certificate (`win.certificateSubjectName` or `CSC_LINK`) and an Apple Developer ID with notarization in `package.json`'s `build` section removes those warnings; the updater needs no change.
