import { readdir, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { execFileSync } from 'node:child_process';

const zip = new AdmZip();
// Use the Git index as the release manifest. Untracked local files and profiles
// must never enter a public source kit just because they sit beside source code.
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const file of files) {
  if (/^(?:\.cache|\.git|node_modules|release|vendor|dist|dist-electron|test-results)(?:\/|$)/.test(file) || /(?:^|\/)(?:\.env(?:\..*)?|control\.json|settings\.json)$|\.(?:log|map|pem|key|p12|pfx)$/i.test(file)) throw new Error('Private or generated file in release manifest: ' + file);
  zip.addLocalFile(file, path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file));
}
// Only pinned upstream Mac archives are included; never include app profiles or user data.
for (const file of await readdir('.cache')) if (/^syncthing-macos-(arm64|amd64)-v2\.1\.7\.zip$/.test(file)) zip.addLocalFile(path.join('.cache', file), '.cache');
await mkdir('release', { recursive: true });
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const output = `release/Sync-it-${version}-Mac-build-kit.zip`;
zip.writeZip(output);
console.log(`Source and verified Mac engine archives: ${output}`);
