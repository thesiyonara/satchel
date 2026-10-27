#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo 'Run this build on a Mac with Node.js 24 installed.'
  exit 1
fi
npm ci
node node_modules/electron/install.js
npm run dist:mac
# Verify each bundle: the ad-hoc signature is intact and the bundled helper still matches the
# runtime pin in shared/engine-integrity.json (the app refuses to start if packaging altered it).
status=0
for app in release/mac*/"Satchel.app"; do
  [[ -d "$app" ]] || continue
  arch=$(lipo -archs "$app/Contents/MacOS/Satchel" 2>/dev/null || echo unknown)
  case "$arch" in arm64) key=darwin-arm64 ;; x86_64) key=darwin-x64 ;; *) key=unknown ;; esac
  expected=$(node -p "require('./shared/engine-integrity.json')['$key'] || ''")
  actual=$(shasum -a 256 "$app/Contents/Resources/engine/syncthing" | cut -d' ' -f1)
  if codesign --verify --strict "$app" && [[ -n "$expected" && "$actual" == "$expected" ]]; then
    echo "OK   $app ($arch): signature valid, bundled helper matches its pin"
  else
    echo "FAIL $app ($arch): signature invalid or helper pin mismatch (expected ${expected:-none}, got $actual)"
    status=1
  fi
done
echo 'Apple Silicon and Intel DMG/ZIP packages are in the release folder.'
echo 'Next: open the app once with right-click → Open (ad-hoc signature), then complete docs/TESTING.md.'
exit $status
