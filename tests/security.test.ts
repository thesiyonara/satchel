import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertSafeToOpen, rendererRequestAllowed, secureDirectory } from '../electron/security';
import { atomicWrite, cleanName, safeRelative } from '../electron/files';
import { Library, RECOVERY_KEEP_PER_NOTE } from '../electron/library';
import { parsePairingCode } from '../electron/sync-engine';

test('renderer network policy is deny-by-default including loopback controls and file URLs', () => {
  for (const url of ['https://example.com/collect', 'http://127.0.0.1:8384/rest/config', 'ws://127.0.0.1:5173', 'file:///C:/secret.txt', 'syncit-app://evil/file', 'syncit-media://other/file', 'javascript:alert(1)']) assert.equal(rendererRequestAllowed(url), false, url);
  assert.equal(rendererRequestAllowed('syncit-app://app/index.html'), true);
  assert.equal(rendererRequestAllowed('syncit-media://image/thumbnail?path=a.png'), true);
  assert.equal(rendererRequestAllowed('syncit-media://media/stream?path=a.mp4'), true);
  assert.equal(rendererRequestAllowed('http://127.0.0.1:5173/src/main.tsx', 'http://127.0.0.1:5173'), true);
  assert.equal(rendererRequestAllowed('http://127.0.0.1:5174', 'http://127.0.0.1:5173'), false);
});
test('scripts, shortcuts, installers, active documents and unknown formats cannot be launched', () => {
  for (const ext of ['exe', 'EXE', 'cmd', 'bat', 'ps1', 'lnk', 'url', 'vbs', 'js', 'html', 'svg', 'desktop', 'app', 'command', 'dmg', 'docm', 'xlsm', 'odt', 'ods', 'odp', 'unknown']) assert.throws(() => assertSafeToOpen(`report.pdf.${ext}`));
  for (const ext of ['png', 'md', 'pdf', 'txt', 'jpg', 'docx']) assert.doesNotThrow(() => assertSafeToOpen(`safe.${ext}`));
});
test('Windows alias paths and malformed pairing values are rejected', () => {
  for (const value of ['.. /secret.md', '.syncit /secret', 'note.md.', 'note.md ', 'CON.txt', 'a/NUL', 'a/COM1.md', 'file\n.md', 'a:stream']) assert.throws(() => safeRelative(value), value);
  for (const value of [null, [], 42, { version: 1, folderId: 9 }]) assert.throws(() => parsePairingCode('syncit1:' + Buffer.from(JSON.stringify(value)).toString('base64url')));
});
test('atomic creation never replaces a file that appeared at the destination', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syncit-security-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'keep.md'); await fs.writeFile(file, 'do not replace');
  await assert.rejects(atomicWrite(file, 'overwrite attempt', false), { code: 'EEXIST' });
  assert.equal(await fs.readFile(file, 'utf8'), 'do not replace');
  assert.deepEqual(await fs.readdir(dir), ['keep.md']);
});
test('atomic write failures clean temporary contents and preserve the previous file', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syncit-security-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'keep.md'); await fs.writeFile(file, 'original');
  const open = fs.open;
  fs.open = (async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args);
    if (String(args[0]).includes('.syncit-tmp-')) handle.writeFile = async () => { throw Object.assign(new Error('full'), { code: 'ENOSPC' }); };
    return handle;
  }) as typeof fs.open;
  try { await assert.rejects(atomicWrite(file, 'new contents'), { code: 'ENOSPC' }); } finally { fs.open = open; }
  assert.equal(await fs.readFile(file, 'utf8'), 'original'); assert.deepEqual(await fs.readdir(dir), ['keep.md']);
});
test('successful note saves keep local recovery copies independently of remote versioning', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syncit-security-'));
  const root = path.join(dir, 'collection'); await fs.mkdir(root);
  const recovery = path.join(dir, 'recovery');
  const library = new Library(root, undefined, undefined, recovery); await library.initialize();
  t.after(async () => { await library.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const first = await library.createNote('A saved original'); await library.saveNote(first.path, 'An edited note', first.revision);
  const versions = await fs.readdir(recovery); assert.equal(versions.length, 1);
  assert.equal(await fs.readFile(path.join(recovery, versions[0]), 'utf8'), first.text);
  assert.equal((await library.readNote(first.path)).text, 'An edited note');
});
test('private storage rejects a substituted directory link', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syncit-security-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'target'); await fs.mkdir(target);
  const link = path.join(dir, 'linked'); await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(secureDirectory(link), /real local directory/); await fs.unlink(link);
});
test('truncated names stay valid and create-if-absent works without hard links', async t => {
  const name = cleanName('x'.repeat(159) + ' tail.md');
  assert.equal(name, 'x'.repeat(159)); assert.doesNotThrow(() => safeRelative(name));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syncit-security-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const link = fs.link;
  fs.link = (async () => { throw Object.assign(new Error('hard links unsupported'), { code: 'EPERM' }); }) as typeof fs.link;
  try {
    await atomicWrite(path.join(dir, 'a.md'), 'first', false);
    await assert.rejects(atomicWrite(path.join(dir, 'a.md'), 'second', false), { code: 'EEXIST' });
  } finally { fs.link = link; }
  assert.equal(await fs.readFile(path.join(dir, 'a.md'), 'utf8'), 'first'); assert.deepEqual(await fs.readdir(dir), ['a.md']);
});
test('note recovery keeps a bounded number of previous versions per note', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syncit-security-'));
  const root = path.join(dir, 'collection'); await fs.mkdir(root); const recovery = path.join(dir, 'recovery');
  const library = new Library(root, undefined, undefined, recovery); await library.initialize();
  t.after(async () => { await library.close(); await fs.rm(dir, { recursive: true, force: true }); });
  let note = await library.createNote('Version 0');
  for (let i = 1; i <= RECOVERY_KEEP_PER_NOTE + 5; i++) note = await library.saveNote(note.path, `Version ${i}`, note.revision);
  const versions = await fs.readdir(recovery);
  assert.equal(versions.length, RECOVERY_KEEP_PER_NOTE);
  const texts = await Promise.all(versions.map(name => fs.readFile(path.join(recovery, name), 'utf8')));
  assert.ok(!texts.includes('Version 0'), 'Oldest versions are pruned first'); assert.ok(texts.includes(`Version ${RECOVERY_KEEP_PER_NOTE + 4}`));
});
