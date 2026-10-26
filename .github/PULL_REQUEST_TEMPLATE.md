## What changes for a user

One or two sentences, written for the changelog. Add the same line under `Unreleased` in `CHANGELOG.md`.

## How it was checked

- [ ] `npm run typecheck` and `npm test`
- [ ] `npm run test:sync` (if pairing, the engine or the collection changed)
- [ ] `npm run test:ui` / `npm run test:features` (if the UI changed), with screenshots attached
- [ ] Docs updated (`README.md`, `docs/`) where behaviour changed

## Notes for review

Anything security-relevant (paths, IPC, control endpoint, phone service, updater), and anything that is deliberately not covered.
