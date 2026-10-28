const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Run after signing, before producing installers: the final helper must match the runtime pin.
module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, 'Satchel.app');
  const executable = path.join(app, 'Contents/MacOS/Satchel');
  const arch = execFileSync('/usr/bin/lipo', ['-archs', executable], { encoding: 'utf8' }).trim();
  const key = arch === 'arm64' ? 'darwin-arm64' : arch === 'x86_64' ? 'darwin-x64' : '';
  const expected = require('../shared/engine-signed-integrity.json')[key] || [require('../shared/engine-integrity.json')[key]];
  const helper = path.join(app, 'Contents/Resources/engine/syncthing');
  const actual = createHash('sha256').update(readFileSync(helper)).digest('hex');
  if (!expected.includes(actual)) throw new Error(`Packaged helper pin mismatch: expected ${expected.join(' or ')}, got ${actual}`);
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  execFileSync(helper, ['--version'], { stdio: 'inherit' });
  console.log(`Verified macOS bundle and pinned helper (${arch})`);
};
