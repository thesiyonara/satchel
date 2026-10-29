// Two instances on one machine pair over loopback. A large file added on one is shown arriving on the other, with its
// sender, progress and the optional notification, then lands marked as arrived from it. Also checks moving an item into a
// folder. The receiving instance is throttled so the transfer stays visible. Run with npm run test:pair.
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { _electron as electron, expect } from '@playwright/test';

const stamp = Date.now();
const profiles = { a: path.resolve('.cache', `pair-a-${stamp}`), b: path.resolve('.cache', `pair-b-${stamp}`) };
const sources = path.resolve('.cache', `pair-sources-${stamp}`);
await Promise.all([mkdir(profiles.a, { recursive: true }), mkdir(profiles.b, { recursive: true }), mkdir(sources, { recursive: true })]);
async function launch(profile, port, extra = {}) {
  const application = await electron.launch({ args: ['.'], env: { ...process.env, SYNCIT_TEST_MODE: '1', SYNCIT_TEST_PROFILE: profile, SYNCIT_TEST_PORT: String(port), ...extra } });
  const page = await application.firstWindow();
  await page.getByRole('button', { name: 'Create collection' }).click();
  return { application, page };
}
const a = await launch(profiles.a, 22741, { SYNCIT_TEST_RECV_KBPS: '3000' });
const b = await launch(profiles.b, 22743);
try {
  await a.page.evaluate(() => window.syncit.settings({ deviceName: 'Desk', arrivalAlerts: true }));
  await b.page.evaluate(() => window.syncit.settings({ deviceName: 'Laptop' }));
  // Wait for both engines to be up, then pair B into A over loopback and approve on A.
  for (const side of [a, b]) await expect.poll(() => side.page.evaluate(() => window.syncit.initial().then(state => state.sync.deviceId)), { timeout: 60000 }).not.toBe('');
  const code = await a.page.evaluate(() => window.syncit.pairingCode());
  await b.page.evaluate(code => window.syncit.join(code, '127.0.0.1'), code);
  const laptop = await b.page.evaluate(() => window.syncit.initial().then(state => state.sync.deviceId));
  await expect.poll(() => a.page.evaluate(() => window.syncit.initial().then(state => state.sync.pending.map(peer => peer.id))), { timeout: 60000 }).toContain(laptop);
  await a.page.evaluate(id => window.syncit.approve(id), laptop);
  for (const side of [a, b]) await expect.poll(() => side.page.evaluate(() => window.syncit.initial().then(state => state.sync.peers.filter(peer => peer.connected).length)), { timeout: 90000 }).toBe(1);
  const controlA = JSON.parse(await readFile(path.join(profiles.a, 'control.json'), 'utf8'));
  const status = async () => { const response = await fetch(`http://127.0.0.1:${controlA.port}/command`, { method: 'POST', headers: { Authorization: `Bearer ${controlA.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'status', args: [] }) }); assert.ok(response.ok, `control endpoint: ${response.status}`); return (await response.json()).result; };
  // A large file added on the laptop is shown arriving on the desk while it transfers: the desk receives at most 3 MB/s, so 24 MB takes several seconds.
  const clip = path.join(sources, 'clip.bin'); await writeFile(clip, randomBytes(24 * 1048576));
  await b.page.evaluate(files => window.syncit.importFiles(files), [clip]);
  await expect.poll(() => a.page.evaluate(() => window.syncit.initial().then(state => state.sync.incoming.find(item => item.name === 'clip.bin')?.from || '')), { timeout: 90000 }).toBe('Laptop');
  await expect(a.page.locator('[data-testid="incoming-card"]', { hasText: 'clip.bin' })).toContainText('Arriving from Laptop');
  await expect(a.page.locator('.rail-sync')).toContainText('Receiving clip.bin');
  await a.page.screenshot({ path: path.resolve('test-results', 'pair-incoming.png') });
  await expect.poll(() => status().then(control => control.notification), { timeout: 30000 }).toBe('clip.bin is arriving from Laptop · 24.0 MB');
  await expect.poll(() => a.page.evaluate(() => window.syncit.initial().then(state => state.sync.incoming.find(item => item.name === 'clip.bin')?.done || 0)), { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(() => a.page.evaluate(() => window.syncit.list().then(snapshot => snapshot.items.find(item => item.name === 'clip.bin')?.arrivedFrom || '')), { timeout: 120000 }).toBe('Laptop');
  await expect.poll(() => a.page.evaluate(() => window.syncit.initial().then(state => state.sync.incoming.length)), { timeout: 30000 }).toBe(0);
  await expect(a.page.locator('[data-testid="incoming-card"]')).toHaveCount(0);
  // A small file added on the laptop arrives on the desk, marked with where it came from.
  const file = path.join(sources, 'from-the-laptop.txt'); await writeFile(file, 'Written on the laptop.\n');
  await b.page.evaluate(files => window.syncit.importFiles(files), [file]);
  await expect.poll(() => a.page.evaluate(() => window.syncit.list().then(snapshot => snapshot.items.find(item => item.name === 'from-the-laptop.txt')?.arrivedFrom || '')), { timeout: 90000 }).toBe('Laptop');
  await expect(a.page.getByRole('button', { name: 'From other computers' })).toBeVisible();
  // A .txt is a note, so its card shows the title without the extension.
  await expect(a.page.locator('[data-testid="item-card"]', { hasText: 'from-the-laptop' }).locator('.arrived')).toContainText('from Laptop');
  // The notification body is recorded in test mode instead of shown; the control endpoint reports it.
  await expect.poll(() => status().then(control => control.notification), { timeout: 30000 }).toBe('from-the-laptop.txt arrived from Laptop');
  // Moving an item into a folder on the desk keeps it in the collection and the folder shows in the sidebar.
  await a.page.evaluate(() => window.syncit.move(['from-the-laptop.txt'], 'Trips'));
  await expect.poll(() => a.page.evaluate(() => window.syncit.list().then(snapshot => snapshot.items.map(item => item.path)))).toContain('Trips/from-the-laptop.txt');
  await expect(a.page.getByRole('button', { name: /^Trips/ })).toBeVisible();
  await expect.poll(() => b.page.evaluate(() => window.syncit.list().then(snapshot => snapshot.items.map(item => item.path))), { timeout: 90000 }).toContain('Trips/from-the-laptop.txt');
  // The pasteboard typed on the laptop shows up in the desk's column within seconds, without a reload, and says who wrote it.
  await b.page.getByRole('textbox', { name: 'Pasteboard text' }).fill('Meeting room 3B, code 7719');
  await expect(a.page.getByRole('textbox', { name: 'Pasteboard text' })).toHaveValue('Meeting room 3B, code 7719', { timeout: 30000 });
  await expect(a.page.getByText(/from Laptop/).first()).toBeVisible();
  await a.page.screenshot({ path: path.resolve('test-results', 'pair-pasteboard.png') });
  console.log('Pair test passed: loopback pairing, a large file shown arriving with sender and progress, arrival marked with its sender, notifications recorded, move to folder synced, pasteboard live between the two.');
} finally {
  await Promise.all([a.application.close(), b.application.close()]);
}
