# Local control and automation

Satchel 0.2.0 includes a CLI for the running desktop app. Node.js 24 is required to run the CLI; the desktop app itself still needs no separate Node installation. This is a local command interface, not an AI service. You can pipe prompts or other text into notes without sending anything to a model.

From a source checkout:

```sh
node scripts/syncit.mjs help
node scripts/syncit.mjs status
node scripts/syncit.mjs window mini
node scripts/syncit.mjs window right
node scripts/syncit.mjs capture "An idea for tomorrow"
node scripts/syncit.mjs list tomorrow
node scripts/syncit.mjs read "An idea for tomorrow.md"
node scripts/syncit.mjs favorite "An idea for tomorrow.md" on
node scripts/syncit.mjs screenshot panel
node scripts/syncit.mjs pause
node scripts/syncit.mjs resume
```

The actual note filename is returned by `capture`; duplicates may get a suffix. `capture --stdin` accepts multiline text, up to 1 MB. `import PATH...` copies files or folders. All successful results are JSON; failures produce a JSON error on stderr and a nonzero exit code. Clipboard access happens only through an explicit `call paste []` command or UI paste.

The installed script is `resources/cli/syncit.mjs` next to the Windows app, or `Satchel.app/Contents/Resources/cli/syncit.mjs` on a Mac build. Run it with `node` using its full path. It detects the usual per-user profile. For a test profile, add `--profile "ABSOLUTE_DIRECTORY"`, or set `SYNCIT_PROFILE`. The app must already be running; an old 0.1.x instance does not have this endpoint.

## Advanced operations

`commands` lists available operations. `call OPERATION JSON_ARRAY` accesses the validated operations listed in `shared/types.ts`, plus:

| Operation | Arguments | Result |
| --- | --- | --- |
| `status` | `[]` | Version, sync status, window visibility/bounds/opacity |
| `window` | `["dashboard" / "quick" / "mini" / "hide" / "left" / "right"]` | Window status |
| `screenshot` | `["dashboard" / "panel"]` | PNG path in the private profile's captures folder |
| `quit` | `[]` | Acknowledgement, then graceful shutdown |

Pairing and history operations from `shared/types.ts` that are useful from the CLI:

| Operation | Arguments | Result |
| --- | --- | --- |
| `connect` | `["DEVICE-ID", "192.168.1.42" (optional), {"encryptionPassword": "…"} (optional)]` | Adds the device and shares the collection; the other side must approve |
| `approve` | `["DEVICE-ID", {"encryptionPassword": "…"} (optional)]` | Approves a pending request; with a password the device receives only encrypted data |
| `revoke` | `["DEVICE-ID"]` | Stops sharing with that device |
| `noteHistory` | `["RELATIVE_PATH"]` | Previous versions (`local` copies and `received` archives), newest first |
| `readNoteVersion` | `["local:…" or "received:…" id from noteHistory]` | The text of that version |

`status` includes `sync.nearby`, the unpaired devices found by local discovery, with their IDs and announced addresses.

Phone access: `phone status` lists paired phones, the port, the certificate fingerprint and whether a pairing window is open; `phone pair` opens a window and prints the offer with its `encoded` QR payload (`syncit-phone:…`), which a client can use directly; `phone cancel` closes the window; `phone revoke ID` removes a phone. Phone access must be turned on in Preferences (or `settings '{"phoneAccess":true}'`) first.

For example in PowerShell:

```powershell
$note = node scripts/syncit.mjs capture 'My prompt' | ConvertFrom-Json
$arguments = ConvertTo-Json -Compress -InputObject @($note.path, 'Updated text', $note.revision)
node scripts/syncit.mjs call saveNote $arguments
node scripts/syncit.mjs settings '{"panelOpacity":0.85,"alwaysOnTop":true}'
Get-Content -Raw ./prompt.txt | node scripts/syncit.mjs capture --stdin
```

`saveNote` requires the revision returned by `read` or `capture`. Stale saves preserve conflicts instead of silently replacing newer text. Imports copy originals; `trash` uses OS Trash and propagates deletion. Pairing approval grants the other device access to the collection: compare the full ID first. `chooseFiles` and `chooseRoot` intentionally show native dialogs; use `import` for unattended imports. Changing the collection directory remains a UI-only selection before pairing.

## Security boundary

The service listens only on a random loopback port. A 256-bit secret rotates each app launch and is stored in `control.json` under the OS-protected app profile, outside the collection. Origin-bearing browser requests, incorrect Host headers, missing credentials and unknown operations are rejected. Requests have size/time/concurrency limits. There is no shell, arbitrary code execution, raw engine API passthrough or debugger access. The renderer cannot call this network endpoint.

This grants account-local automation the same meaningful capabilities as the UI, including clipboard capture, file deletion, pairing and quitting. Do not share `control.json` or give an untrusted process access to your profile. It does not defend against malware already running as you. Screenshots can contain your notes; exports stay private until you choose to share them.

## Test without touching your collection

`npm run test:features` creates an isolated app profile, runs the actual CLI against it, and exercises the floating UI, palette, favorites, note edits, imports, layout, pause/resume and screenshots. `node scripts/package-smoke.mjs` additionally tests the CLI shipped in the hardened Windows package. Neither requires enabling packaged devtools.
