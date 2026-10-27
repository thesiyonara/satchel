# Security policy

Satchel syncs files between computers on a local network with a bundled Syncthing helper, serves an optional phone-access API on that network, and updates itself from GitHub releases. The detailed security model, hardening and known limits are in [docs/SECURITY.md](docs/SECURITY.md).

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private vulnerability reporting on this repository (**Security → Report a vulnerability**). Include the version, platform, steps to reproduce, and what an attacker on the local network or the same machine could gain.

You can expect an acknowledgement within a week. Fixes ship as a new release; the changelog credits reporters who want to be named.

## Supported versions

Only the latest release receives fixes. The in-app updater and the releases page both point at it.

## Scope notes

- Anyone with the pairing code, an approved device ID or a phone pairing window has access to the whole collection by design; those are user decisions, not vulnerabilities.
- Files are stored unencrypted on each computer by design; disk encryption is the operating system's job.
- Reports about Syncthing itself belong to the [Syncthing project](https://github.com/syncthing/syncthing/security); this app pins a specific release and will update it.
