# Third-party notices

Sync it bundles the unmodified Syncthing v2.1.7 binary for the target operating system and CPU architecture.

- Project and source: https://github.com/syncthing/syncthing/tree/v2.1.7
- License: Mozilla Public License 2.0 (MPL-2.0).
- The original `LICENSE.txt` and `AUTHORS.txt` are copied from the verified release archive into the installed `resources/engine` directory.

Electron, React, Vite, Lucide, Chokidar, fast-xml-parser, selfsigned (local TLS certificate for phone access), qrcode-generator (pairing QR codes), and other JavaScript dependencies retain their original licenses. Dependency versions and integrity hashes are recorded in `package-lock.json`; installed packages carry their license files. The only bundled typeface is Instrument Sans by the Instrument Sans Project Authors, under the SIL Open Font License 1.1; its license text ships beside the font files in `src/fonts/OFL.txt` (desktop app) and `web/OFL.txt` (phone page).
