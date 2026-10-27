// Two instances on one machine pair over loopback, then a file added on one shows up on the other marked as arrived
// from it, with the optional notification recorded. Also checks moving an item into a folder. Run with npm run test:pair.
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { _electron as electron, expect } from '@playwright/test';

const stamp = Date.now();
const profiles = { a: path.resolve('.cache', `pair-a-${stamp}`), b: path.resolve('.cache', `pair-b-${stamp}`) };
const sources = path.resolve('.cache', `pair-sources-${stamp}`);
await Promise.all([mkdir(profiles.a, { recursive: true }), mkdir(profiles.b, { recursive: true }), mkdir(sources, { recursive: true })]);
async function launch(profile, port) {
  const application = await electron.launch({ args: ['.'], env: { ...process.env, SYNCIT_TEST_MODE: '1', SYNCIT_TEST_PROFILE: profile, SYNCIT_TEST_PORT: String(port) } });
  const page = await application.firstWindow();
  await page.getByRole('button', { name: 'Create collection' }).click();
  return { application, page };
}
const a = await launch(profiles.a, 22741);
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
  // A file added on the laptop arrives on the desk, marked with where it came from.
  const file = path.join(sources, 'from-the-laptop.txt'); await writeFile(file, 'Written on the laptop.\n');
  await b.page.evaluate(files => window.syncit.importFiles(files), [file]);
  await expect.poll(() => a.page.evaluate(() => window.syncit.list().then(snapshot => snapshot.items.find(item => item.name === 'from-the-laptop.txt')?.arrivedFrom || '')), { timeout: 90000 }).toBe('Laptop');
  await expect(a.page.getByRole('button', { name: 'From other computers' })).toBeVisible();
  // A .txt is a note, so its card shows the title without the extension.
  await expect(a.page.locator('[data-testid="item-card"]', { hasText: 'from-the-laptop' }).locator('.arrived')).toContainText('from Laptop');
  // The notification body is recorded in test mode instead of shown; the control endpoint reports it.
  const controlA = JSON.parse(await readFile(path.join(profiles.a, 'control.json'), 'utf8'));
  const response = await fetch(`http://127.0.0.1:${controlA.port}/command`, { method: 'POST', headers: { Authorization: `Bearer ${controlA.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'status', args: [] }) });
  assert.ok(response.ok, `control endpoint: ${response.status}`);
  const control = (await response.json()).result;
  assert.equal(control.notification, 'from-the-laptop.txt arrived from Laptop', JSON.stringify(control.notification));
  // Moving an item into a folder on the desk keeps it in the collection and the folder shows in the sidebar.
  await a.page.evaluate(() => window.syncit.move(['from-the-laptop.txt'], 'Trips'));
  await expect.poll(() => a.page.evaluate(() => window.syncit.list().then(snapshot => snapshot.items.map(item => item.path)))).toContain('Trips/from-the-laptop.txt');
  await expect(a.page.getByRole('button', { name: /^Trips/ })).toBeVisible();
  await expect.poll(() => b.page.evaluate(() => window.syncit.list().then(snapshot => snapshot.items.map(item => item.path))), { timeout: 90000 }).toContain('Trips/from-the-laptop.txt');
  console.log('Pair test passed: loopback pairing, arrival marked with its sender, notification recorded, move to folder synced.');
} finally {
  await Promise.all([a.application.close(), b.application.close()]);
}
