import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Library, validatePlacement, replaces } from '../electron/library';
import { cleanName, contained, safeRelative, hash } from '../electron/files';
import { SettingsStore, validateSettingsPatch } from '../electron/settings';
import { localIPAllowed, parseLocalAddress, parsePairingCode, validateEncryptionPassword } from '../electron/sync-engine';

async function waitFor(condition: () => Promise<boolean>, message: string, timeout = 8000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await condition().catch(() => false)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Timed out: ${message}`); }

async function fixture(t: test.TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syncit-test-'));
  const root = path.join(dir, 'collection'); await fs.mkdir(root);
  const recycled: string[] = [];
  const library = new Library(root, () => {}, async file => { await fs.rename(file, path.join(dir, 'trashed-' + path.basename(file))); recycled.push(file); });
  await library.initialize();
  t.after(async () => { await library.close(); assert.ok(dir.startsWith(path.join(os.tmpdir(), 'syncit-test-'))); await fs.rm(dir, { recursive: true, force: true }); });
  return { dir, root, library, recycled };
}
test('the pasteboard is one shared text, read with the snapshot and never listed, and replaced texts go to Recent', async t => {
  const { library } = await fixture(t);
  assert.deepEqual((await library.snapshot()).pasteboard, { text: '', updatedAt: 0, from: undefined, recent: [] });
  const saved = await library.savePasteboard('Door code 4411\nhttps://example.test/room', 'Desk');
  assert.equal(saved.text, 'Door code 4411\nhttps://example.test/room'); assert.ok(saved.updatedAt > 0); assert.equal(saved.from, 'Desk');
  // Typing on, appending and fixing a word keep the text; pasting something else over it sends the old text to Recent with its author.
  assert.deepEqual((await library.savePasteboard('Door code 4411\nhttps://example.test/room\nbring the tripod', 'Desk')).recent, []);
  assert.deepEqual((await library.savePasteboard('Door code 4412\nhttps://example.test/room\nbring the tripod', 'Desk')).recent, []);
  const replaced = await library.savePasteboard('ffmpeg -i in.mov out.mp4', 'Laptop');
  assert.equal(replaced.recent.length, 1); assert.equal(replaced.recent[0]!.text, 'Door code 4412\nhttps://example.test/room\nbring the tripod'); assert.equal(replaced.recent[0]!.from, 'Desk'); assert.equal(replaced.from, 'Laptop');
  // Clearing keeps the cleared text; the same text is not kept twice; entries can be removed one by one or all at once.
  const cleared = await library.savePasteboard('', 'Laptop');
  assert.deepEqual(cleared.recent.map(clip => clip.text), ['ffmpeg -i in.mov out.mp4', 'Door code 4412\nhttps://example.test/room\nbring the tripod']);
  await library.savePasteboard('ffmpeg -i in.mov out.mp4', 'Laptop');
  assert.equal((await library.savePasteboard('something else', 'Laptop')).recent.length, 2, 'A text already in Recent is not added again');
  const snapshot = await library.snapshot();
  assert.deepEqual(snapshot.items, [], 'Neither the text nor the clips show as items');
  const one = await library.removeClip(cleared.recent[0]!.id); assert.equal(one.recent.length, 1);
  await assert.rejects(library.removeClip('../escape'), /Invalid pasteboard entry/);
  assert.deepEqual((await library.removeClip()).recent, []);
  await assert.rejects(library.savePasteboard('x'.repeat(2 * 1024 * 1024)), /smaller than 1 MB/);
  await assert.rejects(library.savePasteboard(42 as unknown as string), /smaller than 1 MB/);
  assert.equal(replaces('abc', ''), true); assert.equal(replaces('', 'abc'), false); assert.equal(replaces('hello world', 'hello world!'), false); assert.equal(replaces('hello world', 'see you at 5'), true);
});
test('hidden files and folders are skipped on import and never listed', async t => {
  const { dir, root, library } = await fixture(t);
  const source = path.join(dir, 'shoot'); await fs.mkdir(path.join(source, '.paircut', 'logs'), { recursive: true });
  await fs.writeFile(path.join(source, 'clip.mp4'), 'video'); await fs.writeFile(path.join(source, '.DS_Store'), 'x');
  await fs.writeFile(path.join(source, '.paircut', 'report.json'), '{}'); await fs.writeFile(path.join(source, '.paircut', 'logs', 'pass1.log'), 'log');
  await library.importFiles([source]);
  assert.deepEqual((await library.snapshot()).items.map(item => item.path), ['shoot/clip.mp4']);
  await assert.rejects(fs.access(path.join(root, 'shoot', '.paircut')), { code: 'ENOENT' });
  await assert.rejects(library.importFiles([path.join(source, '.paircut')]), /Hidden files and folders are not imported/);
  // Imports can land inside an existing folder; a missing folder or a path outside the collection is refused.
  await fs.writeFile(path.join(dir, 'extra.txt'), 'extra');
  await library.importFiles([path.join(dir, 'extra.txt')], 'shoot');
  assert.deepEqual((await library.snapshot()).items.map(item => item.path).sort(), ['shoot/clip.mp4', 'shoot/extra.txt']);
  await assert.rejects(library.importFiles([path.join(dir, 'extra.txt')], 'gone'), /no longer in the collection/);
  await assert.rejects(library.importFiles([path.join(dir, 'extra.txt')], '../outside'));
  // A hidden file that reaches the collection another way (another computer, a tool) stays out of the listing.
  await fs.mkdir(path.join(root, '.cache')); await fs.writeFile(path.join(root, '.cache', 'index.json'), '{}'); await fs.writeFile(path.join(root, '.hidden-note.md'), 'secret');
  library['index'] = undefined;
  assert.deepEqual((await library.snapshot()).items.map(item => item.path).sort(), ['shoot/clip.mp4', 'shoot/extra.txt']);
});
test('path validation rejects traversal, reserved files, alternate data streams and absolute paths', () => {
  for (const value of ['../secret', 'a/../../b', 'C:\\secret', '/secret', 'file:stream', '.syncit/board/key', '.stversions/note.md', 'a//b', 'a/./b', 'a\0b', '~syncthing~file.tmp']) assert.throws(() => safeRelative(value), value);
  assert.equal(safeRelative('Notes\\hello.md'), 'Notes/hello.md');
  assert.ok(!/con|\?/i.test(cleanName('CON')));
  assert.equal(cleanName('hello?.md'), 'hello-.md');
});
test('library indexes normal files, imports copies, and avoids duplicate filename overwrites', async t => {
  const { dir, root, library } = await fixture(t);
  const source = path.join(dir, 'hello.txt'); await fs.writeFile(source, 'hello');
  await library.importFiles([source, source]);
  const snapshot = await library.snapshot();
  assert.equal(snapshot.items.length, 2); assert.equal(snapshot.items[0].kind, 'note');
  assert.notEqual(snapshot.items[0].path, snapshot.items[1].path);
  assert.equal(await fs.readFile(source, 'utf8'), 'hello');
  assert.equal((await fs.readdir(root)).filter(name => name.startsWith('.syncit-tmp')).length, 0);
  await assert.rejects(library.importFiles([dir]), /contains the collection/);
});
test('stale note saves keep both edits, including a remotely deleted note', async t => {
  const { root, library } = await fixture(t);
  const original = await library.createNote('First thought');
  const remote = await library.saveNote(original.path, 'Remote changes', original.revision);
  const stale = await library.saveNote(original.path, 'Unsaved local changes', original.revision);
  assert.equal(stale.conflict, true); assert.notEqual(stale.path, original.path);
  assert.equal((await library.readNote(original.path)).text, 'Remote changes');
  assert.equal((await library.readNote(stale.path)).text, 'Unsaved local changes');
  await fs.unlink(path.join(root, original.path));
  const recovered = await library.saveNote(original.path, 'Recovery after deletion', remote.revision);
  assert.equal(recovered.conflict, true); assert.equal(recovered.text, 'Recovery after deletion');
});
test('pinboard records survive app rename; malformed remote records do not break the library', async t => {
  const { root, library } = await fixture(t);
  const note = await library.createNote('A pinned idea');
  await library.place({ version: 1, path: note.path, x: 50, y: 60, width: 280, height: 300, updatedAt: 0 });
  const renamed = await library.rename(note.path, 'A better name.md');
  assert.equal((await library.snapshot()).placements[0].path, renamed);
  await fs.writeFile(path.join(root, '.syncit', 'board', '0'.repeat(64) + '.json'), '{bad');
  assert.equal((await library.snapshot()).placements.length, 1);
  await library.unpin(renamed); assert.equal((await library.snapshot()).placements.length, 0);
  assert.throws(() => validatePlacement({ version: 1, path: renamed, x: NaN, y: 0, width: 280, height: 280, updatedAt: 0 }));
});
test('trash is recoverable and unavailable roots are not silently recreated', async t => {
  const { root, library, recycled } = await fixture(t);
  const note = await library.createNote('Keep a recovery copy'); await library.trash(note.path);
  assert.equal(recycled.length, 1); assert.equal((await library.snapshot()).items.length, 0);
  await library.close(); await fs.rename(root, root + '-moved');
  assert.ok((await library.snapshot()).error);
  await assert.rejects(fs.access(root));
});
test('linked paths cannot escape the collection', async t => {
  const { root, dir } = await fixture(t);
  const outside = path.join(dir, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'secret.md'), 'private');
  await fs.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(contained(root, 'linked/secret.md'), /Linked/);
  await fs.unlink(path.join(root, 'linked'));
});
test('preferences serialize concurrent changes and reject protected fields', async t => {
  const { dir, root } = await fixture(t);
  const store = new SettingsStore(path.join(dir, 'prefs'), root); await store.load();
  await Promise.all([store.update({ deviceName: 'New name' }), store.update({ alwaysOnTop: false })]);
  assert.equal(store.value.deviceName, 'New name'); assert.equal(store.value.alwaysOnTop, false);
  assert.throws(() => validateSettingsPatch({ root: 'C:/secret' }));
});
test('pairing codes have bounded, validated identities and reject internet IPs', () => {
  assert.throws(() => parsePairingCode('hello'));
  assert.throws(() => parsePairingCode('syncit1:' + Buffer.from(JSON.stringify({ version: 1, deviceId: '../x' })).toString('base64url')));
  assert.equal(localIPAllowed('8.8.8.8'), false);
  assert.equal(localIPAllowed('https://example.com'), false);
  assert.equal(localIPAllowed('127.0.0.1', true), true);
  assert.equal(localIPAllowed('127.0.0.1'), false);
  assert.equal(parseLocalAddress(undefined), undefined); assert.equal(parseLocalAddress('', true), undefined);
  assert.equal(parseLocalAddress('127.0.0.1', true), 'tcp://127.0.0.1:22027');
  assert.equal(parseLocalAddress('tcp://127.0.0.1:22100', true), 'tcp://127.0.0.1:22100');
  for (const value of ['8.8.8.8', 'tcp://127.0.0.1:80', 'evil.test', 'tcp://[::1]:22027', 42]) assert.throws(() => parseLocalAddress(value, true), String(value));
  assert.equal(validateEncryptionPassword(undefined), undefined); assert.equal(validateEncryptionPassword(''), undefined);
  assert.equal(validateEncryptionPassword('long enough'), 'long enough');
  for (const value of ['short', 'bad\ncontrol', 42, 'x'.repeat(129)]) assert.throws(() => validateEncryptionPassword(value));
});
test('video and audio files are their own kinds', async t => {
  const { root, library } = await fixture(t);
  for (const name of ['clip.MP4', 'talk.m4a', 'tone.wav', 'archive.zip', 'photo.jpg', 'shot.HEIC', 'report.pdf', 'data.json']) await fs.writeFile(path.join(root, name), 'x');
  const kinds = Object.fromEntries((await library.snapshot()).items.map(item => [item.name, item.kind]));
  assert.deepEqual(kinds, { 'clip.MP4': 'video', 'talk.m4a': 'audio', 'tone.wav': 'audio', 'archive.zip': 'file', 'photo.jpg': 'image', 'shot.HEIC': 'image', 'report.pdf': 'file', 'data.json': 'file' });
  const { previewKind, browserRenders } = await import('../shared/media');
  assert.equal(previewKind('report.pdf'), 'pdf'); assert.equal(previewKind('data.json'), 'text'); assert.equal(previewKind('archive.zip'), null);
  assert.equal(browserRenders('photo.jpg'), true); assert.equal(browserRenders('shot.HEIC'), false);
});
test('the index follows changes made outside the app without a full rescan', async t => {
  const { root, library } = await fixture(t);
  assert.equal((await library.snapshot()).items.length, 0);
  await fs.writeFile(path.join(root, 'external.md'), 'Written outside the app');
  await waitFor(async () => (await library.snapshot()).items.some(item => item.path === 'external.md' && item.preview === 'Written outside the app'), 'external file indexed');
  await fs.mkdir(path.join(root, 'Sub')); await fs.writeFile(path.join(root, 'Sub', 'nested.txt'), 'nested');
  await waitFor(async () => (await library.snapshot()).items.some(item => item.path === 'Sub/nested.txt'), 'nested file indexed');
  await fs.writeFile(path.join(root, 'external.md'), 'Edited outside the app');
  await waitFor(async () => (await library.snapshot()).items.find(item => item.path === 'external.md')?.preview === 'Edited outside the app', 'external edit indexed');
  await fs.rm(path.join(root, 'Sub'), { recursive: true });
  await waitFor(async () => !(await library.snapshot()).items.some(item => item.path.startsWith('Sub/')), 'removed folder dropped from index');
});
test('note history lists local and received versions and refuses paths outside their stores', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syncit-test-'));
  const root = path.join(dir, 'collection'); await fs.mkdir(root); const recovery = path.join(dir, 'recovery');
  const library = new Library(root, () => {}, undefined, recovery); await library.initialize();
  t.after(async () => { await library.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const note = await library.createNote('First text'); await library.saveNote(note.path, 'Second text', note.revision);
  const base = path.basename(note.path, '.md');
  await fs.mkdir(path.join(root, '.stversions'), { recursive: true });
  await fs.writeFile(path.join(root, '.stversions', `${base}~20260101-120000.md`), 'Archived by Syncthing');
  await fs.writeFile(path.join(root, '.stversions', `other~20260101-120000.md`), 'Different note');
  const versions = await library.history(note.path);
  assert.deepEqual(versions.map(version => version.source).sort(), ['local', 'received']);
  assert.equal(await library.readVersion(versions.find(version => version.source === 'local')!.id), 'First text');
  assert.equal(await library.readVersion(versions.find(version => version.source === 'received')!.id), 'Archived by Syncthing');
  const renamed = await library.rename(note.path, 'Renamed note.md');
  const afterRename = await library.history(renamed);
  assert.equal(afterRename.filter(version => version.source === 'local').length, 1, 'local history follows an app rename');
  assert.equal(await library.readVersion(afterRename.find(version => version.source === 'local')!.id), 'First text');
  await assert.rejects(library.readVersion('received:../settings~20260101-120000.json'));
  await assert.rejects(library.readVersion('local:../secret-1700000000000-abcdef.md'));
  await assert.rejects(library.readVersion('settings.json'));
});
test('out-of-space import leaves the original and no partially visible destination', async t => {
  const { dir, root, library } = await fixture(t);
  const source = path.join(dir, 'large.bin'); await fs.writeFile(source, 'original');
  const originalCopy = fs.copyFile;
  fs.copyFile = async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
  try { await assert.rejects(library.importFiles([source]), { code: 'ENOSPC' }); }
  finally { fs.copyFile = originalCopy; }
  assert.equal(await fs.readFile(source, 'utf8'), 'original');
  assert.ok(!(await fs.readdir(root)).some(name => name === 'large.bin' || name.startsWith('.syncit-tmp-')));
});
