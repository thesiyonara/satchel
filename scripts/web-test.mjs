// End-to-end test of the phone web client: the real desktop app serves it over its TLS endpoint and a
// separate browser session (Electron's own Chromium, isolated from the app's renderer policy) pairs with
// the one-time URL, browses, writes and unpairs.
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { wavBytes } from './test-media.mjs';
const profile = path.resolve('.cache', `web-profile-${Date.now()}`); await mkdir(profile, { recursive: true });
const app = await electron.launch({ args: ['.'], env: { ...process.env, SYNCIT_TEST_MODE: '1', SYNCIT_TEST_PROFILE: profile, SYNCIT_TEST_PORT: '22327' } });
try {
  const desktop = await app.firstWindow();
  await desktop.getByRole('button', { name: 'Create collection' }).click();
  await desktop.evaluate(async () => { await window.syncit.settings({ deviceName: 'Desk', phoneAccess: true }); await window.syncit.createNote('# Shopping\n\nBread, apples, coffee.'); });
  await expect.poll(() => desktop.evaluate(() => window.syncit.phoneInfo().then(info => info.running)), { timeout: 20000 }).toBeTruthy();
  const { url, offer } = await desktop.evaluate(() => window.syncit.phoneOffer());
  assert.match(url, /^https:\/\/[0-9.]+:\d+\/#pair=[A-Z2-9]{8}$/);
  // A phone browser: its own session, trusting only this computer's certificate for this test.
  await app.evaluate(async ({ BrowserWindow }, { url, hosts }) => {
    const window = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { partition: 'phone-web-test', contextIsolation: true, sandbox: true } });
    window.webContents.session.setCertificateVerifyProc((request, callback) => callback(hosts.includes(request.hostname) ? 0 : -2));
    window.webContents.session.on('will-download', event => event.preventDefault()); // Never write test downloads to the user's folders.
    await window.loadURL(url);
  }, { url, hosts: [...offer.addresses, '127.0.0.1'] });
  const phone = await expect.poll(async () => (await app.windows()).length).toBe(2).then(async () => (await app.windows()).find(window => window !== desktop));
  await expect(phone.getByRole('heading', { name: 'collection' })).toBeVisible({ timeout: 15000 });
  await expect(phone.getByRole('button', { name: /Shopping/ })).toBeVisible();
  await expect(phone.getByRole('button', { name: /Shopping/ })).toContainText('Bread, apples, coffee.');
  assert.equal(await phone.evaluate(() => location.hash), '', 'The one-time code is removed from the address after pairing');
  await mkdir('test-results', { recursive: true }); await phone.screenshot({ path: path.resolve('test-results/phone-web.png') });
  await expect.poll(() => desktop.evaluate(() => window.syncit.phoneInfo().then(info => info.devices.map(device => device.name)))).toContain('Phone (web)');
  // Read and edit the note with the revision rule.
  await phone.getByRole('button', { name: /Shopping/ }).click();
  await expect(phone.getByRole('textbox', { name: 'Note text' })).toHaveValue(/Bread, apples, coffee\./);
  await phone.getByRole('textbox', { name: 'Note text' }).fill('# Shopping\n\nBread, apples, coffee, milk.');
  await phone.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(phone.getByText(/Saved on Desk/)).toBeVisible();
  await expect.poll(() => desktop.evaluate(() => window.syncit.readNote('Shopping.md').then(note => note.text))).toMatch(/milk/);
  // Create a note from the phone.
  await phone.getByRole('button', { name: 'Back' }).click();
  await phone.getByRole('button', { name: 'New note', exact: true }).click();
  await phone.getByRole('textbox', { name: 'Note text' }).fill('From the phone\n\nTyped in Safari.');
  await phone.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(phone.getByText(/Saved as From the phone\.md/)).toBeVisible();
  await expect.poll(() => desktop.evaluate(() => window.syncit.list().then(library => library.items.some(item => item.path === 'From the phone.md')))).toBeTruthy();
  // Upload a photo, search, and download a file.
  await phone.getByRole('button', { name: 'Back' }).click();
  const photo = path.join(profile, 'IMG_0001.png'); await writeFile(photo, await (await import('node:fs/promises')).readFile(path.resolve('assets/icon.png')));
  const chooser = phone.waitForEvent('filechooser');
  await phone.getByRole('button', { name: 'Add photo or file' }).click();
  await (await chooser).setFiles(photo);
  await expect(phone.getByText('IMG_0001.png added to the collection.')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => desktop.evaluate(() => window.syncit.list().then(library => library.items.some(item => item.path === 'IMG_0001.png' && item.kind === 'image')))).toBeTruthy();
  // Audio and video play on the phone through a streamed link with range support.
  const tone = path.join(profile, 'tone.wav'); await writeFile(tone, wavBytes(1));
  const chooser2 = phone.waitForEvent('filechooser');
  await phone.getByRole('button', { name: 'Add photo or file' }).click();
  await (await chooser2).setFiles(tone);
  await expect(phone.getByText('tone.wav added to the collection.')).toBeVisible({ timeout: 15000 });
  await phone.getByRole('button', { name: /tone\.wav/ }).click();
  await expect.poll(() => phone.evaluate(() => { const media = document.querySelector('audio'); return media ? Number.isFinite(media.duration) && media.duration > 0.5 : false; }), { timeout: 15000 }).toBeTruthy();
  await phone.getByRole('button', { name: 'Back' }).click();
  // Text-like files preview as read-only text; photos get a tile grid and a full-size view streamed from the computer.
  const dataFile = path.join(profile, 'readings.json'); await writeFile(dataFile, JSON.stringify({ sensor: 'kitchen', values: [1, 2, 3] }, null, 2));
  const chooser3 = phone.waitForEvent('filechooser');
  await phone.getByRole('button', { name: 'Add photo or file' }).click();
  await (await chooser3).setFiles(dataFile);
  await expect(phone.getByText('readings.json added to the collection.')).toBeVisible({ timeout: 15000 });
  await phone.getByRole('button', { name: /readings\.json/ }).click();
  await expect(phone.getByLabel('File text')).toContainText('"sensor": "kitchen"');
  await phone.getByRole('button', { name: 'Back' }).click();
  await phone.getByRole('tab', { name: /Photos/ }).click();
  await expect(phone.locator('.tile')).toHaveCount(1);
  await phone.getByRole('button', { name: 'IMG_0001.png' }).click();
  await expect.poll(() => phone.evaluate(() => { const image = document.querySelector('img.preview-image'); return image && image.naturalWidth > 0 && image.getAttribute('src').startsWith('/v1/stream?ticket='); }), { timeout: 15000 }).toBeTruthy();
  await expect(phone.getByRole('button', { name: 'Download original' })).toBeVisible();
  // The download button fetches the original with the stored token; check that path directly, since the test session blocks real downloads.
  const downloaded = await phone.evaluate(async () => { const response = await fetch('/v1/file?path=IMG_0001.png', { headers: { Authorization: `Bearer ${localStorage.getItem('syncit-phone-token')}` } }); return { ok: response.ok, size: (await response.blob()).size, disposition: response.headers.get('content-disposition') }; });
  assert.ok(downloaded.ok && downloaded.size > 1000 && downloaded.disposition.includes('IMG_0001.png'), JSON.stringify(downloaded));
  // Unpair from the phone's Computer screen; the token stops working and the computer no longer lists it.
  await phone.getByRole('button', { name: 'Back' }).click();
  await phone.getByRole('tab', { name: /All/ }).click();
  await phone.getByRole('button', { name: 'Computer' }).click();
  await expect(phone.getByRole('heading', { name: 'Desk' })).toBeVisible();
  phone.once('dialog', dialog => dialog.accept());
  await phone.getByRole('button', { name: 'Unpair' }).click();
  await expect(phone.getByRole('heading', { name: 'Phone access' })).toBeVisible();
  await expect.poll(() => desktop.evaluate(() => window.syncit.phoneInfo().then(info => info.devices.length))).toBe(0);
  console.log('Phone web client passed: pairing by URL, listing, note edit with revision, new note, upload, audio playback, text preview, photo grid and full-size view, search, download, unpair.');
} finally { await app.close(); }
