import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { execFileSync } from 'node:child_process';
// Usage: node scripts/fetch-engine.mjs [platform] [arch] [--write-pins]
// --write-pins records the extracted executable's SHA-256 in shared/engine-integrity.json
// (only when bumping the pinned Syncthing version). Without it a mismatch fails the build.

export const version = 'v2.1.7';
const hashes = {
  'windows-amd64': '3ce7da770f546a8d02b65b2e7ee31f2a3b8b7c3f990ede045590cca4172ecfe1',
  'windows-arm64': 'd535ffd611b3af223de64bc5dfc60c378881eb13d5c8ecb1431b7407094c15ff',
  'macos-amd64': 'b8be90176d0f24daebae7b5aaddac52ebfae395df6d99f5e0e54656db00868cb',
  'macos-arm64': '2df075b463231a307c91da657157beaed06383a941ba7ea04d33d536e3c4af38'
};
const platform = process.argv[2] || process.platform;
const arch = process.argv[3] || process.arch;
const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : platform;
const key = `${os}-${arch === 'x64' ? 'amd64' : arch}`;
if (!hashes[key]) throw new Error(`No pinned engine for ${platform}/${arch}`);
// electron-builder uses "win" and "mac" for its ${os} macro.
const dir = path.resolve('vendor', `${platform === 'win32' ? 'win' : 'mac'}-${arch}`);
const exe = os === 'windows' ? 'syncthing.exe' : 'syncthing';
const archive = `syncthing-${key}-${version}.zip`;
await mkdir('.cache', { recursive: true });
const cache = path.resolve('.cache', archive);
let bytes;
try { bytes = await readFile(cache); } catch {
  console.log(`Downloading Syncthing ${version} for ${platform}/${arch}…`);
  const response = await fetch(`https://github.com/syncthing/syncthing/releases/download/${version}/${archive}`);
  if (!response.ok) throw new Error(`Engine download failed: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(bytes).digest('hex') !== hashes[key]) throw new Error('Engine archive checksum mismatch');
await writeFile(cache, bytes);
await mkdir(dir, { recursive: true });
const zip = new AdmZip(bytes);
// Upstream archives also contain etc/freebsd-rc/syncthing (an rc shell script), so match the
// exact top-level entry instead of any name ending in "/syncthing".
const prefix = `syncthing-${key}-${version}/`;
let executableDigest = '';
for (const basename of [exe, 'LICENSE.txt', 'AUTHORS.txt']) {
  const entry = zip.getEntry(prefix + basename);
  if (!entry || entry.isDirectory) throw new Error(`Archive missing ${prefix}${basename}`);
  const content = entry.getData();
  if (basename === exe) {
    const magic = content.subarray(0, 4);
    const isPE = os === 'windows' && content.subarray(0, 2).toString('latin1') === 'MZ';
    const isMachO = os === 'macos' && ['cffaedfe', 'cefaedfe', 'cafebabe', 'feedfacf', 'feedface'].includes(magic.toString('hex'));
    if (content.length < 8 * 1024 * 1024 || !(isPE || isMachO)) throw new Error(`Extracted ${basename} is not a ${os} executable (${content.length} bytes, magic ${magic.toString('hex')})`);
    executableDigest = createHash('sha256').update(content).digest('hex');
  }
  const target = path.join(dir, basename);
  const existing = await readFile(target).catch(() => null);
  if (!existing?.equals(content)) await writeFile(target, content);
}
if (platform !== 'win32') await chmod(path.join(dir, exe), 0o755);
await writeFile(path.join(dir, 'VERSION'), version + '\n');
// Keep the runtime integrity pin (shared/engine-integrity.json) in step with what was extracted.
const pinsFile = path.resolve('shared', 'engine-integrity.json');
const pins = JSON.parse(await readFile(pinsFile, 'utf8'));
const pinKey = `${platform}-${arch}`;
if (pins[pinKey] !== executableDigest) {
  if (!process.argv.includes('--write-pins')) throw new Error(`Runtime pin for ${pinKey} is ${pins[pinKey] || 'missing'} but the extracted executable hashes to ${executableDigest}. Rerun with --write-pins when upgrading the engine deliberately.`);
  pins[pinKey] = executableDigest;
  await writeFile(pinsFile, JSON.stringify(pins, null, 2) + '\n');
  console.log(`Updated runtime pin ${pinKey}`);
}
console.log(`Verified engine ready: ${dir} (${exe} sha256 ${executableDigest})`);
// Sign only after verifying the untouched upstream executable. Always start from the archive:
// signing an already signed Mach-O can produce different bytes. Pin the complete signed file,
// and keep electron-builder from signing it again when it signs the enclosing app.
const signedPins = JSON.parse(await readFile('shared/engine-signed-integrity.json', 'utf8'));
if (signedPins[pinKey]) {
  if (process.platform !== 'darwin') throw new Error('Prepare the signed macOS helper on a Mac');
  const target = path.join(dir, exe);
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'local.syncit.syncthing', '--timestamp=none', target], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', target], { stdio: 'inherit' });
  const signedDigest = createHash('sha256').update(await readFile(target)).digest('hex');
  if (signedDigest !== signedPins[pinKey]) throw new Error(`Signed helper pin mismatch: expected ${signedPins[pinKey]}, got ${signedDigest}. Review the signing output before updating its pin.`);
  console.log(`Verified signed engine: ${signedDigest}`);
}
