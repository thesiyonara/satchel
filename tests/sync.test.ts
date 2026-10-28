import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { XMLParser } from 'fast-xml-parser';
import { SyncEngine } from '../electron/sync-engine';
import { Library } from '../electron/library';
import { hash } from '../electron/files';
import type { Settings } from '../shared/types';

async function waitFor(condition: () => Promise<boolean>, message: string, timeout = 30000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await condition().catch(() => false)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw new Error(`Timed out: ${message}`); }
async function port(): Promise<number> { return new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = (server.address() as net.AddressInfo).port; server.close(() => resolve(port)); }); }); }
test('a modified pinned helper is rejected before it can generate a profile', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syncit-tampered-engine-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const name = process.platform === 'win32' ? 'syncthing.exe' : 'syncthing';
  const original = path.resolve('vendor', `${process.platform === 'win32' ? 'win' : 'mac'}-${process.arch}`, name);
  const executable = path.join(dir, name);
  await fs.copyFile(original, executable);
  await fs.appendFile(executable, 'tampered');
  const home = path.join(dir, 'engine');
  const engine = new SyncEngine({ executable, home, settings: () => { throw new Error('Must reject before reading settings'); }, updateSettings: async () => {} });
  await assert.rejects(engine.start(), /integrity check/);
  assert.equal(engine.status.state, 'error');
  await assert.rejects(fs.access(home));
});
test('real Syncthing pair: offline-safe LAN configuration, two-way files, layouts, conflict, resume, recovery', { timeout: 180000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syncit-integration-'));
  const engines: SyncEngine[] = []; const libraries: Library[] = [];
  t.after(async () => { await Promise.all(engines.map(engine => engine.stop())); await Promise.all(libraries.map(library => library.close())); assert.ok(dir.startsWith(path.join(os.tmpdir(), 'syncit-integration-'))); await fs.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 }); });
  const executable = path.resolve('vendor', `${process.platform === 'win32' ? 'win' : 'mac'}-${process.arch}`, process.platform === 'win32' ? 'syncthing.exe' : 'syncthing');
  async function instance(name: string) {
    const root = path.join(dir, name, 'collection'); await fs.mkdir(root, { recursive: true });
    const settings: Settings = { version: 1, root, folderId: randomUUID(), deviceName: name, onboardingDone: true, startAtLogin: false, alwaysOnTop: true, shortcut: '', theme: 'system' };
    const listenPort = await port();
    const engine = new SyncEngine({ executable, home: path.join(dir, name, 'engine'), settings: () => settings, updateSettings: async patch => { Object.assign(settings, patch); }, port: listenPort, allowLoopback: true, discovery: false });
    const library = new Library(root, () => { void engine.scan(); });
    engines.push(engine); libraries.push(library); await library.initialize(); await engine.start();
    return { engine, library, settings, root, port: listenPort };
  }
  const a = await instance('Desktop'); const b = await instance('Mac-test-peer');
  for (const engine of engines) {
    const config = await engine.api('/config');
    assert.equal(config.options.globalAnnounceEnabled, false); assert.equal(config.options.relaysEnabled, false); assert.equal(config.options.natEnabled, false);
    assert.equal(config.options.crashReportingEnabled, false); assert.equal(config.options.autoUpgradeIntervalH, 0); assert.equal(config.options.urAccepted, -1);
    assert.equal(config.options.releasesURL, ''); assert.equal(config.options.stunServers?.filter(Boolean).length || 0, 0);
    assert.ok(config.gui.address.startsWith('127.0.0.1:'));
    assert.equal(config.gui.user, 'syncit-private'); assert.match(config.gui.password, /^\$2[aby]\$/);
    for (const endpoint of ['/rest/config', '/rest/system/status', '/metrics']) {
      const response = await fetch(`http://${config.gui.address}${endpoint}`, { redirect: 'manual' });
      assert.ok([401, 403].includes(response.status), `Unauthenticated ${endpoint} must be rejected (got ${response.status})`);
    }
    // The public login shell may return 200; it must not expose configuration or credentials.
    const login = await fetch(`http://${config.gui.address}/`);
    const loginText = await login.text();
    assert.ok(!loginText.includes(config.gui.apiKey));
    const wrongHost = await fetch(`http://${config.gui.address}/rest/config`, { headers: { 'Host': 'attacker.invalid' } });
    assert.ok([401, 403].includes(wrongHost.status));
    assert.ok(config.devices[0].allowedNetworks.includes('!0.0.0.0/0'));
  }
  await b.engine.join(a.engine.pairingCode(), '127.0.0.1');
  await waitFor(async () => { await a.engine.refresh(); return a.engine.status.pending.length > 0; }, 'pair request');
  await a.engine.approve(b.engine.status.deviceId);
  await waitFor(async () => { await a.engine.refresh(); await b.engine.refresh(); return a.engine.status.peers[0]?.connected && b.engine.status.peers[0]?.connected; }, 'peer connection');
  const connections = await a.engine.api('/system/connections');
  assert.match(connections.connections[b.engine.status.deviceId].crypto, /^TLS1\.[23]/);
  const note = await a.library.createNote('Hello from the desktop'); const start = Date.now(); await a.engine.scan();
  await waitFor(async () => (await b.library.readNote(note.path)).text === note.text, 'desktop note transfer');
  t.diagnostic(`Small note reached the peer in ${Date.now() - start} ms`);
  const bNote = await b.library.readNote(note.path); await b.library.saveNote(note.path, 'Reply from the other computer', bNote.revision); await b.engine.scan();
  await waitFor(async () => (await a.library.readNote(note.path)).text === 'Reply from the other computer', 'reverse edit');
  await a.library.place({ version: 1, path: note.path, x: 240, y: 90, width: 320, height: 280, updatedAt: 0 }); await a.engine.scan();
  await waitFor(async () => (await b.library.snapshot()).placements.some(p => p.x === 240), 'board layout');
  const blob = randomBytes(8 * 1024 * 1024); await fs.writeFile(path.join(a.root, 'payload.bin'), blob); await a.engine.scan();
  await waitFor(async () => hash(await fs.readFile(path.join(b.root, 'payload.bin'))) === hash(blob), 'binary transfer');
  // Slow a second transfer until a real temporary file is present, then interrupt it.
  await a.engine.api('/config/options', 'PATCH', { limitBandwidthInLan: true });
  await a.engine.api(`/config/devices/${b.engine.status.deviceId}`, 'PATCH', { maxSendKbps: 256 });
  const interrupted = randomBytes(4 * 1024 * 1024);
  await fs.writeFile(path.join(a.root, 'interrupted.bin'), interrupted); await a.engine.scan();
  await waitFor(async () => (await fs.readdir(b.root)).some(name => name.includes('interrupted') && name.endsWith('.tmp')), 'partial transfer started');
  await b.engine.stop();
  await a.engine.api(`/config/devices/${b.engine.status.deviceId}`, 'PATCH', { maxSendKbps: 0 });
  await b.engine.start();
  await waitFor(async () => hash(await fs.readFile(path.join(b.root, 'interrupted.bin'))) === hash(interrupted), 'interrupted transfer resumed');
  await b.engine.stop();
  const beforeA = await a.library.readNote(note.path); const beforeB = await b.library.readNote(note.path);
  await a.library.saveNote(note.path, 'Offline desktop edit', beforeA.revision); await a.engine.scan();
  await b.library.saveNote(note.path, 'Offline other computer edit', beforeB.revision);
  await b.engine.start(); await b.engine.scan();
  await waitFor(async () => (await a.library.snapshot()).items.some(item => item.conflict), 'offline conflict preserved', 45000);
  const contents = await Promise.all((await a.library.snapshot()).items.filter(item => item.kind === 'note').map(item => a.library.readNote(item.path)));
  assert.ok(contents.some(note => note.text === 'Offline desktop edit')); assert.ok(contents.some(note => note.text === 'Offline other computer edit'));
  // A received delete must archive the remote copy in the configured version store.
  await fs.unlink(path.join(a.root, 'payload.bin')); await a.engine.scan();
  await waitFor(async () => { try { await fs.access(path.join(b.root, 'payload.bin')); return false; } catch { return true; } }, 'delete propagation', 80000);
  assert.ok((await fs.readdir(path.join(b.root, '.stversions'))).some(name => name.startsWith('payload')));
  // Restart must keep identity and resume the same paired collection.
  const identity = b.engine.status.deviceId; await b.engine.stop(); await b.engine.start(); assert.equal(b.engine.status.deviceId, identity);
  await waitFor(async () => { await b.engine.refresh(); return b.engine.status.peers[0]?.connected; }, 'restart reconnection');
  // Unexpected helper exit is supervised by the application, not a second monitor process.
  await b.engine.api('/system/shutdown', 'POST');
  await waitFor(async () => b.engine.status.state === 'error' || b.engine.status.state === 'starting', 'helper exit detected');
  await waitFor(async () => { await b.engine.refresh(); return b.engine.status.peers[0]?.connected && b.engine.status.state !== 'error'; }, 'helper automatically restarted');
  assert.equal(b.engine.status.deviceId, identity);
  const outsider = await instance('Untrusted-device');
  await outsider.engine.join(a.engine.pairingCode(), '127.0.0.1');
  await waitFor(async () => { await a.engine.refresh(); return a.engine.status.pending.some(peer => peer.id === outsider.engine.status.deviceId); }, 'untrusted request');
  assert.equal((await outsider.library.snapshot()).items.length, 0, 'unapproved computer must not receive any collection contents');
  await assert.rejects(a.engine.approve(outsider.engine.status.deviceId, { encryptionPassword: 'short' }), /between 8 and 128/);
  // An untrusted device may be approved for encrypted data only. Its plain folder never receives readable files.
  await a.engine.approve(outsider.engine.status.deviceId, { encryptionPassword: 'correct horse battery' });
  await waitFor(async () => { await a.engine.refresh(); return a.engine.status.peers.some(peer => peer.id === outsider.engine.status.deviceId && peer.encrypted); }, 'encrypted peer listed');
  assert.equal(a.engine.status.peers.length, 2, 'more than one computer can be paired');
  const shared = (await a.engine.api('/config/folders'))[0].devices.find((device: { deviceID: string }) => device.deviceID === outsider.engine.status.deviceId);
  assert.equal(shared.encryptionPassword, 'correct horse battery');
  assert.ok(a.engine.status.peers.find(peer => peer.id === b.engine.status.deviceId && !peer.encrypted), 'trusted peer settings are preserved');
  await new Promise(resolve => setTimeout(resolve, 3000));
  assert.equal((await outsider.library.snapshot()).items.length, 0, 'an encrypted-only device never receives readable files');
  await a.engine.revoke(outsider.engine.status.deviceId);
  await waitFor(async () => { await a.engine.refresh(); return a.engine.status.peers.length === 1; }, 'encrypted device revoked');
  await outsider.engine.stop();
  a.settings.syncPaused = true; await a.engine.configure();
  await waitFor(async () => { await a.engine.refresh(); return a.engine.status.state === 'paused'; }, 'pause status');
  const pausedNote = await a.library.createNote('Created while paused');
  await new Promise(resolve => setTimeout(resolve, 1200));
  await assert.rejects(fs.access(path.join(b.root, pausedNote.path)));
  a.settings.syncPaused = false; await a.engine.configure(); await a.engine.scan();
  await waitFor(async () => (await b.library.readNote(pausedNote.path)).text === pausedNote.text, 'resume transfers');
  // An app crash can leave its helper running. A new supervisor must authenticate
  // that helper's profile, shut it down, and regain ownership without a DB lock loop.
  const previousConfig = await b.engine.api('/config'); await b.engine.stop();
  const orphan = spawn(executable, ['serve', '--home', path.join(dir, 'Mac-test-peer', 'engine'), '--no-upgrade', '--no-browser', '--no-restart'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, STMONITORED: '1', STNOUPGRADE: '1' } });
  let orphanLog = ''; orphan.stdout.on('data', data => { orphanLog = (orphanLog + data).slice(-4000); }); orphan.stderr.on('data', data => { orphanLog = (orphanLog + data).slice(-4000); });
  t.after(() => { if (orphan.exitCode === null) orphan.kill(); });
  await waitFor(async () => (await fetch(`http://${previousConfig.gui.address}/rest/system/ping`, { headers: { 'X-API-Key': previousConfig.gui.apiKey } })).ok, 'orphan running');
  const persisted = new XMLParser().parse(await fs.readFile(path.join(dir, 'Mac-test-peer', 'engine/config.xml'), 'utf8')).configuration.gui;
  assert.equal(persisted.address, previousConfig.gui.address);
  assert.ok(persisted.apikey === previousConfig.gui.apiKey, 'Persisted control credential must match the running helper');
  try { await b.engine.start(); } catch (error) { t.diagnostic(`Orphan exit=${orphan.exitCode}, signal=${orphan.signalCode}, log=${orphanLog}`); throw error; } assert.equal(b.engine.status.deviceId, identity);
  await waitFor(async () => orphan.exitCode !== null, 'orphan stopped safely');
  await waitFor(async () => { await b.engine.refresh(); return b.engine.status.peers[0]?.connected; }, 'orphan recovery connection');
  await a.engine.revoke(b.engine.status.deviceId);
  await waitFor(async () => { await b.engine.refresh(); return !b.engine.status.peers[0]?.connected; }, 'revocation closes connection');
  const revokedNote = await a.library.createNote('Not shared with revoked computer'); await a.engine.scan();
  await new Promise(resolve => setTimeout(resolve, 1200));
  await assert.rejects(fs.access(path.join(b.root, revokedNote.path)));
  assert.equal(a.engine.status.peers.length, 0);
  // Pairing without a code: connect by device ID, approve on the other side, then both converge on one collection ID.
  const c = await instance('Code-free-peer');
  await assert.rejects(c.engine.connect(c.engine.status.deviceId), /this computer’s ID/);
  await assert.rejects(c.engine.connect('not-a-device-id'), /full device ID/);
  await c.engine.connect(a.engine.status.deviceId, `tcp://127.0.0.1:${a.port}`);
  await waitFor(async () => { await a.engine.refresh(); return a.engine.status.pending.some(peer => peer.id === c.engine.status.deviceId); }, 'code-free request');
  const converged = [a.settings.folderId, c.settings.folderId].sort()[0];
  await a.engine.approve(c.engine.status.deviceId);
  await waitFor(async () => { await a.engine.refresh(); await c.engine.refresh(); return a.settings.folderId === converged && c.settings.folderId === converged; }, 'folder IDs converge on the smaller one', 60000);
  const convergedNote = await a.library.createNote('Shared after code-free pairing'); await a.engine.scan();
  await waitFor(async () => (await c.library.readNote(convergedNote.path)).text === convergedNote.text, 'code-free transfer', 60000);
  assert.ok((await a.library.snapshot()).items.length > 0, 'adopting a folder ID keeps local files');
  await c.engine.stop();
  const tampered = path.join(dir, process.platform === 'win32' ? 'modified.exe' : 'modified');
  await fs.copyFile(executable, tampered); await fs.appendFile(tampered, 'modified');
  const badEngine = new SyncEngine({ executable: tampered, home: path.join(dir, 'bad-engine'), settings: () => a.settings, updateSettings: async () => {} });
  await assert.rejects(badEngine.start(), /integrity check/);
});
