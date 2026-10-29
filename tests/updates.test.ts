import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { selectRelease, newer, Updates, verifyInstaller, describeFailure, HttpError, type ReleaseClient } from '../electron/updates';
import { validateSettingsPatch } from '../electron/settings';
import { repository, releasesAPI } from '../shared/project';

const download = (version: string, name: string) => `https://github.com/${repository}/releases/download/v${version}/${name}`;
const release = (version: string, prerelease = false, draft = false) => ({ tag_name: `v${version}`, prerelease, draft, assets: [
  { name: `Satchel-${version}-win-x64.exe`, size: 4, browser_download_url: download(version, `Satchel-${version}-win-x64.exe`) },
  { name: `Satchel-${version}-mac-arm64.dmg`, size: 4, browser_download_url: download(version, `Satchel-${version}-mac-arm64.dmg`) },
  { name: `Satchel-${version}-mac-arm64.zip`, size: 4, browser_download_url: download(version, `Satchel-${version}-mac-arm64.zip`) },
  { name: `SHA256SUMS-${version}.txt`, size: 120, browser_download_url: download(version, `SHA256SUMS-${version}.txt`) }
] });
/** A fake GitHub: serves the release list and writes assets from `files` by name. */
function fakeClient(releases: unknown[], files: () => Record<string, Buffer | string>, log: string[] = []): ReleaseClient {
  return {
    async json(url) { log.push(url); assert.ok(url.startsWith(releasesAPI)); return releases; },
    async download(url, file, limit) {
      log.push(url);
      const name = url.split('/').at(-1)!; const body = files()[name];
      if (body === undefined) throw new HttpError(404, url);
      if (Buffer.byteLength(body) > limit) throw new Error('The download is larger than allowed');
      await fs.writeFile(file, body, { flag: 'wx' });
    }
  };
}

test('update selection forbids downgrades, drafts, unapproved previews, missing assets and foreign download hosts', () => {
  assert.equal(newer('0.10.0', '0.9.9'), true);
  const releases = [release('0.1.1'), release('0.3.0', true), release('0.2.1'), release('0.4.0', false, true)];
  assert.equal(selectRelease(releases, '0.2.0', false, 'x64')?.version, '0.2.1');
  assert.equal(selectRelease(releases, '0.2.0', true, 'x64')?.version, '0.3.0');
  assert.equal(selectRelease(releases, '0.3.0', true, 'x64'), null);
  assert.equal(selectRelease(releases, '0.2.0', true, 'arm64'), null);
  assert.equal(selectRelease(releases, '0.2.0', false, 'arm64', 'darwin')?.filename, 'Satchel-0.2.1-mac-arm64.zip', 'A Mac updates from the zip archive, which the app can unpack and swap in');
  assert.equal(selectRelease(releases, '0.2.0', false, 'x64', 'darwin'), null);
  assert.equal(selectRelease([{ ...release('0.2.1'), assets: [] }], '0.2.0', true, 'x64'), null);
  assert.equal(selectRelease([{ ...release('0.2.1'), tag_name: '../../evil' }], '0.2.0', true, 'x64'), null);
  const foreign = release('0.2.1'); foreign.assets[0].browser_download_url = 'https://evil.example/Satchel-0.2.1-win-x64.exe';
  assert.equal(selectRelease([foreign], '0.2.0', false, 'x64'), null, 'assets must be served from this repository');
  assert.equal(selectRelease(releases, '0.2.0', false, 'x64')?.installerURL, download('0.2.1', 'Satchel-0.2.1-win-x64.exe'));
  assert.deepEqual(validateSettingsPatch({ updateChecks: true, updatePreviews: false }), { updateChecks: true, updatePreviews: false });
  assert.throws(() => validateSettingsPatch({ lastUpdateCheck: 0 }));
});
test('download verifies checksum, rechecks before install, rejects corruption and allows recovery', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'syncit-updates-'));
  t.after(async () => { assert.ok(path.basename(home).startsWith('syncit-updates-')); await fs.rm(home, { recursive: true, force: true }); });
  const payload = Buffer.from('test-only installer bytes'); const digest = createHash('sha256').update(payload).digest('hex');
  let corrupt = false; const log: string[] = [];
  const updater = new Updates(home, '0.2.0', () => {}, 'win32', 'x64', fakeClient([release('0.2.1')], () => ({ 'Satchel-0.2.1-win-x64.exe': corrupt ? 'wrong' : payload, 'SHA256SUMS-0.2.1.txt': `${digest}  Satchel-0.2.1-win-x64.exe\n` }), log));
  assert.equal(log.length, 0, 'No request before explicit check');
  await assert.rejects(updater.installer());
  assert.equal((await updater.check(false)).phase, 'available');
  assert.equal(log.length, 1, 'Checks do not download');
  corrupt = true; assert.equal((await updater.download()).phase, 'error');
  assert.deepEqual(await fs.readdir(path.join(home, 'updates')), []);
  corrupt = false; assert.equal((await updater.download()).phase, 'ready');
  assert.ok(log.at(-1)!.endsWith('/Satchel-0.2.1-win-x64.exe') && log.at(-2)!.endsWith('/SHA256SUMS-0.2.1.txt'), 'checksums are fetched before the installer');
  const file = await updater.installer(); await fs.appendFile(file, 'tampered');
  await assert.rejects(updater.installer(), /checksum mismatch/);
  await fs.writeFile(file, payload);
  const checksum = path.join(path.dirname(file), 'SHA256SUMS-0.2.1.txt');
  await fs.appendFile(checksum, `${digest}  Satchel-0.2.1-win-x64.exe\n`);
  await assert.rejects(verifyInstaller(file, checksum, path.basename(file)), /ambiguous/);
});
test('unsupported platforms and request errors are actionable without attempting installation', async () => {
  const failing = (error: Error): ReleaseClient => ({ json: async () => { throw error; }, download: async () => { throw error; } });
  const linux = new Updates('/unused', '0.2.0', () => {}, 'linux', 'x64', failing(new Error('should not run')));
  assert.equal((await linux.check(false)).phase, 'unsupported');
  const offline = new Updates('/unused', '0.2.0', () => {}, 'win32', 'x64', failing(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })));
  assert.equal((await offline.check(false)).phase, 'error'); assert.match(offline.state.message || '', /unreachable/);
  await assert.rejects(offline.installer());
  const limited = new Updates('/unused', '0.2.0', () => {}, 'win32', 'x64', failing(new HttpError(403, releasesAPI)));
  assert.match((await limited.check(false)).message || '', /limiting requests/);
  assert.match(describeFailure(new HttpError(404, 'x')), /not found/);
  assert.match(describeFailure(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), /did not answer in time/);
  assert.match(describeFailure(Object.assign(new Error('aborted'), { name: 'AbortError' })), /cancelled/);
});
test('quitting cancels an active request', async () => {
  const hanging: ReleaseClient = { json: (_url, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })), download: async () => {} };
  const updater = new Updates('/unused', '0.2.0', () => {}, 'win32', 'x64', hanging);
  const checking = updater.check(false); await updater.stop();
  const state = await checking; assert.equal(state.phase, 'error'); assert.match(state.message || '', /cancelled/);
});
test('macOS updates select the zip archive, verify it, and stale downloads are removed at startup', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'syncit-updates-'));
  t.after(async () => { assert.ok(path.basename(home).startsWith('syncit-updates-')); await fs.rm(home, { recursive: true, force: true }); });
  const stale = path.join(home, 'updates', 'download-old'); await fs.mkdir(stale, { recursive: true }); await fs.writeFile(path.join(stale, 'Satchel-0.2.0-mac-arm64.dmg'), 'old');
  const payload = Buffer.from('test-only disk image bytes'); const digest = createHash('sha256').update(payload).digest('hex');
  const updater = new Updates(home, '0.2.0', () => {}, 'darwin', 'arm64', fakeClient([release('0.2.1')], () => ({ 'Satchel-0.2.1-mac-arm64.zip': payload, 'SHA256SUMS-0.2.1.txt': `${digest}  Satchel-0.2.1-mac-arm64.zip\n${digest}  Satchel-0.2.1-win-x64.exe\n` })));
  await updater.clean();
  await assert.rejects(fs.access(stale), 'Stale downloads from earlier sessions are removed');
  assert.equal((await updater.check(false)).phase, 'available');
  const ready = await updater.download(); assert.equal(ready.phase, 'ready'); assert.match(ready.message || '', /in place/);
  assert.ok((await updater.installer()).endsWith('Satchel-0.2.1-mac-arm64.zip'));
  await updater.clean(); assert.equal(updater.state.phase, 'ready', 'A verified download held by this session is kept');
  await fs.access(await updater.installer());
});

test('macOS install swaps the unpacked bundle in for the running one and backs out when it cannot', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'syncit-updates-'));
  t.after(async () => { assert.ok(path.basename(home).startsWith('syncit-updates-')); await fs.rm(home, { recursive: true, force: true }); });
  const apps = path.join(home, 'Applications'); const bundle = path.join(apps, 'Satchel.app');
  await fs.mkdir(path.join(bundle, 'Contents'), { recursive: true }); await fs.writeFile(path.join(bundle, 'Contents', 'Info.plist'), 'old');
  const downloads = path.join(home, 'updates', 'download-x'); await fs.mkdir(downloads, { recursive: true });
  const archive = path.join(downloads, 'Satchel-0.2.1-mac-arm64.zip'); await fs.writeFile(archive, 'archive');
  // A stand-in for ditto: the archive holds one app bundle, named after whatever bundle is being replaced.
  const unpack = (name: string) => async (_archive: string, into: string) => { await fs.mkdir(path.join(into, name, 'Contents'), { recursive: true }); await fs.writeFile(path.join(into, name, 'Contents', 'Info.plist'), 'new'); };
  const copy = async () => { throw new Error('copy is only for another volume'); };
  const updater = new Updates(home, '0.2.0', () => {}, 'darwin', 'arm64', { json: async () => { throw new Error('unused'); }, download: async () => { throw new Error('unused'); } });
  const swapped = await updater.replaceBundle(archive, bundle, { unpack: unpack('Satchel.app'), copy });
  assert.deepEqual(swapped, { replaced: true, app: bundle });
  assert.equal(await fs.readFile(path.join(bundle, 'Contents', 'Info.plist'), 'utf8'), 'new');
  assert.equal(await fs.readFile(path.join(downloads, 'previous', 'Contents', 'Info.plist'), 'utf8'), 'old', 'The old bundle is parked under updates, which the next start removes');
  await assert.rejects(fs.access(bundle + '.incoming'));
  // Running from a translocated or mounted location: nothing is replaced and the unpacked app is handed over.
  const moved = await updater.replaceBundle(archive, '/private/var/folders/ab/AppTranslocation/cd/d/Satchel.app', { unpack: unpack('Satchel.app'), copy });
  assert.equal(moved.replaced, false); assert.match(moved.reason || '', /temporary location/); await fs.access(path.join(moved.app, 'Contents', 'Info.plist'));
  // The running bundle cannot be moved aside: the unpacked app goes back where it was and nothing else changes.
  const gone = path.join(apps, 'Gone.app');
  const failed = await updater.replaceBundle(archive, gone, { unpack: unpack('Gone.app'), copy });
  assert.equal(failed.replaced, false); assert.ok(failed.reason);
  await fs.access(path.join(failed.app, 'Contents', 'Info.plist')); await assert.rejects(fs.access(gone + '.incoming')); await assert.rejects(fs.access(gone));
  assert.equal(await fs.readFile(path.join(bundle, 'Contents', 'Info.plist'), 'utf8'), 'new');
});
