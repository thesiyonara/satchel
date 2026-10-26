# Public release hygiene

The public project starts at 0.4.0 from a source-only snapshot. Earlier development history, local build outputs, app profiles and session logs are not part of that snapshot.

- Run `npm run privacy:check` before publishing. It checks tracked text for credential patterns, personal Windows profile paths and the current local account name. It cannot identify every kind of personal information; review images and release notes too.
- README screenshots use an isolated sample collection, a neutral computer name and documentation-only network values. They are representative UI images, not a real device's network identity.
- Installers include compiled app files, the verified helper and required assets. Source maps and log files are excluded. The app creates its own keys, settings and collection after installation.
- Source kits include only files in the Git index, plus pinned upstream Mac helper archives. They refuse private/generated paths; unrelated untracked files are not copied.
- Prefer GitHub-hosted runners for public builds so build logs use runner paths rather than a maintainer's local profile. Review uploaded artifacts; never attach local app profiles, clipboard data or maintenance backups.
- Before attaching diagnostic logs to an issue, remove home-directory paths, computer names, local addresses, device IDs and any keys or tokens. Logs generated on a user's own computer can naturally contain that user's local paths.

The GitHub repository owner remains visible in repository URLs, account metadata and GitHub actions. A clean project history cannot erase copies, caches or downloads made while an earlier repository was public. Contact the relevant host if externally cached material needs removal.
