# Contributing

Thanks for helping. Satchel is a small, opinionated app, so the useful contributions are the ones that keep it small and honest.

## Ground rules

- **Local only.** No accounts, cloud services, relays, telemetry or web fonts. Anything that sends data off the local network needs a discussion first and must be off by default.
- **One vocabulary.** The synced folder is the *collection*; machines are *this computer* and *paired computers*; the floating window is *Quick drop*; the canvas is the *pinboard*. No slogans in operational screens. See [docs/DESIGN.md](docs/DESIGN.md).
- **Every control does something.** Decorative badges and cards are not added.
- **Security posture stays.** Read [docs/SECURITY.md](docs/SECURITY.md) before touching paths, IPC, the control endpoint, the phone service or the updater. Dependencies are pinned to exact versions; adding one needs a reason in the pull request.
- **Tests go with changes.** Behaviour in `electron/` gets a unit test; anything touching sync gets a case in `tests/sync.test.ts`; visible UI changes update `scripts/ui-test.mjs`.

## Setup

Node.js 24 on Windows 10+ or macOS 13+.

```sh
npm ci
node node_modules/electron/install.js
npm run fetch:engine
npm run dev
```

## Checks before a pull request

```sh
npm run typecheck
npm test
npm run test:sync
npm run test:ui        # Windows or macOS with a desktop session; opens real windows
```

CI runs typecheck, unit tests and the two-engine integration suite on Windows and macOS for every push and pull request.

## Pull requests

- One topic per pull request, with the user-visible change described in a sentence a reader of the changelog would understand. Add that sentence under `Unreleased` in [CHANGELOG.md](CHANGELOG.md).
- Keep the code style of the file you are in: compact, typed, no new abstractions for one call site.
- Screenshots for UI changes, from `npm run test:ui` or `node scripts/screenshots.mjs`.
- Security-relevant findings go through [SECURITY.md](SECURITY.md), not a public issue.
