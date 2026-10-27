import { _electron as electron, expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import https from 'node:https';
import { wavBytes } from './test-media.mjs';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = path.resolve('.cache', `ui-profile-${Date.now()}`);
// Import sources live outside the app profile: private app storage is refused as an import source.
const sources = path.resolve('.cache', `ui-sources-${Date.now()}`);
const artifacts = path.resolve('test-results');
await mkdir(profile, { recursive: true }); await mkdir(sources, { recursive: true }); await mkdir(artifacts, { recursive: true });
const application = await electron.launch({ args: ['.'], env: { ...process.env, SYNCIT_TEST_MODE: '1', SYNCIT_TEST_PROFILE: profile, SYNCIT_TEST_PORT: '22127' } });
const errors = [];
try {
  const page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('button', { name: 'Create collection' })).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: path.join(artifacts, 'welcome.png') });
  await page.getByRole('button', { name: 'Create collection' }).click();
  await expect(page.getByRole('heading', { name: 'Everything', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note text' }).fill('A place for the in-between\n\nNotes from the desktop. Inspiration for the laptop.\n\n• Capture the thought\n• Give it a little space\n• Pick it up on the other computer');
  await expect(page.getByText('Saved on this computer')).toBeVisible();
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  const first = await page.locator('[data-testid="item-card"]').first().getAttribute('data-path');
  await page.getByLabel(`Actions for ${first}`).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'Filename', exact: true }).fill('A place for the in-between.md');
  await page.getByRole('button', { name: 'Rename', exact: true }).last().click();
  await page.evaluate(async () => {
    await window.syncit.createNote('Weekend possibilities\n\nA slow morning. A long walk.\nFind that little bookshop again.\n\nLeave room for something unplanned.');
    await window.syncit.createNote('Small things, worth keeping\n\nThe name of that song.\nA recipe from a friend.\nAn idea before it disappears.');
    await window.syncit.createNote('Desk → laptop\n\nEverything I need for the next session.\nThe same space, a different view.');
  });
  await page.evaluate(async image => { await window.syncit.importFiles([image]); }, path.resolve('assets/icon.png'));
  const source = path.join(sources, 'weekend-list.csv'); await writeFile(source, 'Thing,Status\nFinish the little project,In progress\nTake a walk,Always a good idea\n');
  await page.evaluate(async source => window.syncit.importFiles([source]), source);
  await expect(page.locator('[data-testid="item-card"]')).toHaveCount(6);
  await expect(page.locator('.image-preview img')).toBeVisible();
  await expect.poll(() => page.locator('.image-preview img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  if (await page.getByRole('button', { name: 'Dismiss message' }).isVisible()) await page.getByRole('button', { name: 'Dismiss message' }).click();
  await page.screenshot({ path: path.join(artifacts, 'dashboard.png') });
  // Dragging something that is already in the window (a thumbnail here) must not import anything or create a note.
  const before = await page.locator('[data-testid="item-card"]').count();
  await page.locator('.item-card.image img').first().dragTo(page.locator('.collection-caption'));
  await page.locator('[data-testid="item-card"]').first().dragTo(page.locator('.page-heading'));
  await page.waitForTimeout(800);
  assert.equal(await page.locator('[data-testid="item-card"]').count(), before, 'An in-app drag adds nothing');
  // Dragging a card out hands the OS the real file (the drag itself is skipped in test mode); paths outside the collection are refused.
  const imagePath = await page.locator('.item-card.image').first().getAttribute('data-path');
  const dragged = await page.evaluate(relative => window.syncit.dragOut(relative), imagePath);
  assert.ok(dragged.file.endsWith(imagePath.replace(/\//g, path.sep)) && path.isAbsolute(dragged.file), JSON.stringify(dragged));
  await assert.rejects(page.evaluate(() => window.syncit.dragOut('../settings.json')));
  await page.getByRole('textbox', { name: 'Search the collection' }).fill('bookshop');
  await expect(page.locator('[data-testid="item-card"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear search' }).click();
  // Audio and video open in an in-app player streamed from the collection.
  const tone = path.join(sources, 'tone.wav'); await writeFile(tone, wavBytes(1));
  await page.evaluate(async source => window.syncit.importFiles([source]), tone);
  await page.getByRole('button', { name: 'Open tone.wav' }).click();
  await expect(page.getByRole('dialog', { name: 'Media player' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => { const media = document.querySelector('.media-modal audio'); return media ? Number.isFinite(media.duration) && media.duration > 0.5 : false; }), { timeout: 15000 }).toBeTruthy();
  await page.screenshot({ path: path.join(artifacts, 'media-player.png') });
  await page.getByRole('button', { name: 'Close preview' }).click();
  // Text-like files preview read-only inside the app.
  const dataFile = path.join(sources, 'readings.json'); await writeFile(dataFile, JSON.stringify({ sensor: 'kitchen', values: [1, 2, 3] }, null, 2));
  await page.evaluate(async source => window.syncit.importFiles([source]), dataFile);
  await page.getByRole('button', { name: 'Open readings.json' }).click();
  await expect(page.getByRole('dialog', { name: 'Text preview' })).toBeVisible();
  await expect(page.getByLabel('File text')).toContainText('"sensor": "kitchen"');
  await page.getByRole('button', { name: 'Close preview' }).click();
  // The Quick drop window carries its own opacity control.
  const itemPaths = await page.locator('[data-testid="item-card"]').evaluateAll(cards => cards.map(card => card.getAttribute('data-path')));
  await page.evaluate(async paths => { for (const [i, path] of paths.slice(0, 3).entries()) await window.syncit.place({ version: 1, path, x: 35 + i * 260, y: 45 + i % 2 * 70, width: 240, height: 275, updatedAt: Date.now() }); }, itemPaths);
  await page.getByRole('button', { name: 'Pinboard view', exact: true }).click();
  await expect(page.locator('.board-card')).toHaveCount(3);
  const handle = page.locator('.board-handle', { hasText: itemPaths[0].split('/').at(-1) }); const box = await handle.boundingBox(); // the card placed at (35, 45)
  await page.mouse.move(box.x + 35, box.y + 12); await page.mouse.down(); await page.mouse.move(box.x + 95, box.y + 47, { steps: 6 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.syncit.list().then(l => l.placements.some(p => p.x === 95 && p.y === 80)))).toBeTruthy();
  await page.screenshot({ path: path.join(artifacts, 'pinboard.png') });
  await page.getByRole('button', { name: 'Open Quick drop', exact: true }).click();
  const panel = await expect.poll(async () => (await application.windows()).length).toBe(2).then(async () => (await application.windows()).find(p => p !== page));
  await expect(panel.getByRole('heading', { name: 'Add to the collection' })).toBeVisible();
  await panel.getByRole('button', { name: 'Window opacity' }).click();
  await panel.getByRole('slider', { name: 'Floating window opacity' }).focus();
  await panel.keyboard.press('ArrowLeft'); await panel.keyboard.press('ArrowLeft'); await panel.keyboard.press('ArrowLeft'); await panel.keyboard.press('ArrowLeft');
  await expect.poll(() => page.evaluate(() => window.syncit.initial().then(i => i.settings.panelOpacity))).toBe(0.8);
  await panel.keyboard.press('End');
  await expect.poll(() => page.evaluate(() => window.syncit.initial().then(i => i.settings.panelOpacity))).toBe(1);
  await panel.getByRole('button', { name: 'Window opacity' }).click();
  await panel.screenshot({ path: path.join(artifacts, 'quick-drop.png') });
  // Preserve the user's clipboard while exercising the real desktop paste route. A locked or remote
  // desktop session makes the Windows clipboard unavailable; those steps are then skipped, not failed.
  const clipboardAvailable = await application.evaluate(async ({ clipboard, ClipboardItem }) => {
    globalThis.__savedClipboard = [];
    for (const item of await clipboard.read()) {
      const values = {};
      for (const type of item.types) values[type] = await item.getType(type);
      if (Object.keys(values).length) globalThis.__savedClipboard.push(new ClipboardItem(values)); // Some apps leave typeless items behind.
    }
    await clipboard.writeText('Clipboard integration test');
    return (await clipboard.readText()) === 'Clipboard integration test';
  });
  if (!clipboardAvailable) console.log('SKIPPED clipboard capture: the system clipboard is unavailable in this session (locked or remote desktop).');
  else try {
    await panel.getByRole('button', { name: 'Paste from clipboard' }).click();
    await expect.poll(() => page.evaluate(() => window.syncit.list().then(l => l.items.some(i => i.preview === 'Clipboard integration test')))).toBeTruthy();
    const png = (await readFile('assets/icon.png')).toString('base64');
    await application.evaluate(async ({ clipboard, ClipboardItem }, png) => { await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(png, 'base64')], { type: 'image/png' }) })]); }, png);
    await panel.getByRole('button', { name: 'Paste from clipboard' }).click();
    await expect.poll(() => page.evaluate(() => window.syncit.list().then(l => l.items.some(i => i.name.startsWith('Screenshot '))))).toBeTruthy();
  } finally { await application.evaluate(async ({ clipboard }) => { if (globalThis.__savedClipboard.length) await clipboard.write(globalThis.__savedClipboard); else clipboard.clear(); }); }
  await page.getByRole('button', { name: 'Preferences', exact: false }).click();
  await expect(page.getByRole('dialog', { name: 'Preferences', exact: true })).toBeVisible();
  await page.getByLabel('Appearance').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Close preferences' }).click();
  await page.getByRole('button', { name: 'Grid view', exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, 'dashboard-dark.png') });
  // Note history and the read-only Markdown preview.
  await page.locator('[data-testid="item-card"]', { hasText: 'A place for the in-between' }).getByRole('button', { name: /^Open / }).click();
  await page.getByRole('button', { name: 'Preview Markdown' }).click();
  await expect(page.locator('.markdown').getByText('Notes from the desktop. Inspiration for the laptop.')).toBeVisible();
  assert.equal(await page.locator('.markdown a, .markdown script, .markdown img').count(), 0, 'Preview renders no links, scripts or images');
  await page.getByRole('button', { name: 'Edit note' }).click();
  await page.getByRole('button', { name: 'Note history' }).click();
  await expect(page.locator('.note-history li')).toHaveCount(1);
  await page.locator('.note-history li button').first().click();
  await expect(page.getByRole('button', { name: 'Restore this version' })).toBeEnabled();
  await page.screenshot({ path: path.join(artifacts, 'note-history.png') });
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  await page.getByRole('button', { name: 'Not paired yet', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Nearby' })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'computers.png') });
  await page.getByRole('button', { name: 'Close preferences' }).click();
  // Phone access: turn it on, pair over loopback with the one-time code from the pairing panel, read the collection with the token, remove the phone.
  const phoneRequest = (port, method, pathname, { token, json } = {}) => new Promise((resolve, reject) => {
    const headers = {}; if (token) headers.Authorization = `Bearer ${token}`; if (json) headers['Content-Type'] = 'application/json';
    const request = https.request({ host: '127.0.0.1', port, method, path: pathname, headers, rejectUnauthorized: false }, response => {
      const fingerprint = response.socket.getPeerCertificate().fingerprint256; const chunks = [];
      response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, fingerprint, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') }));
    });
    request.on('error', reject); request.end(json ? JSON.stringify(json) : undefined);
  });
  await page.getByRole('button', { name: 'Preferences', exact: false }).click();
  await page.getByRole('checkbox', { name: /Let a paired phone/ }).click();
  await expect(page.getByRole('checkbox', { name: /Let a paired phone/ })).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.syncit.phoneInfo().then(info => info.running && info.fingerprint)), { timeout: 20000 }).toBeTruthy();
  await page.getByRole('button', { name: 'Pair a phone' }).click();
  await expect(page.getByRole('img', { name: 'Pairing QR code' })).toBeVisible();
  await expect(page.getByText('Point the phone’s camera at this code')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'phone-access.png') });
  const phone = await page.evaluate(() => window.syncit.phoneInfo());
  const code = (await page.locator('.phone-pairing .pairing-code').textContent()).trim();
  assert.equal((await phoneRequest(phone.port, 'GET', '/v1/items')).status, 401, 'The phone API needs a token');
  const paired = await phoneRequest(phone.port, 'POST', '/v1/pair', { json: { code, name: 'Test phone' } });
  assert.equal(paired.status, 201); assert.equal(paired.fingerprint, phone.fingerprint, 'The live certificate matches the fingerprint shown for pinning');
  const phoneItems = await phoneRequest(phone.port, 'GET', '/v1/items', { token: paired.json.token });
  assert.ok(phoneItems.json.items.some(item => item.name === 'A place for the in-between.md'), 'A paired phone sees the collection');
  await expect(page.getByText('Test phone')).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect.poll(() => phoneRequest(phone.port, 'GET', '/v1/items', { token: paired.json.token }).then(reply => reply.status)).toBe(401);
  await page.getByRole('checkbox', { name: /Let a paired phone/ }).click();
  await expect(page.getByRole('checkbox', { name: /Let a paired phone/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Close preferences' }).click();
  const security = await page.evaluate(async () => {
    const payload = '<img src="https://example.com/track" onerror="window.pwned=true"><script>window.pwned=true</script>';
    await window.syncit.createNote(payload);
    let networkBlocked = false;
    try { await fetch('https://example.com/'); } catch { networkBlocked = true; }
    const initial = await window.syncit.initial();
    localStorage.setItem('syncit-draft-v1:recovery-test', JSON.stringify({ runId: 'previous-app-run', root: initial.settings.root, path: 'lost-note.md', text: 'Recovered security-test draft', revision: '', savedAt: Date.now() }));
    return { networkBlocked, nodeExposed: typeof window.require !== 'undefined' };
  });
  assert.equal(security.networkBlocked, true); assert.equal(security.nodeExposed, false);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  const scriptPath = path.join(sources, 'do-not-run.cmd'); await writeFile(scriptPath, '@echo off\nexit /b 99');
  await page.evaluate(async source => window.syncit.importFiles([source]), scriptPath);
  const privateImport = await page.evaluate(async source => { try { await window.syncit.importFiles([source]); return 'allowed'; } catch (error) { return String(error); } }, path.join(profile, 'settings.json'));
  assert.match(privateImport, /Private application data/);
  const blocked = await page.evaluate(async () => { try { await window.syncit.open('do-not-run.cmd'); return false; } catch { return true; } });
  assert.equal(blocked, true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.syncit.list().then(l => l.items.some(i => i.preview === 'Recovered security-test draft')))).toBeTruthy();
  assert.equal(await page.evaluate(() => localStorage.getItem('syncit-draft-v1:recovery-test')), null);
  assert.deepEqual(errors, []);
  console.log(`UI passed: onboarding, note autosave, rename, import, image preview, search, pinboard drag, Quick drop, ${clipboardAvailable ? 'real clipboard paste' : 'clipboard paste SKIPPED'}, theme, Markdown preview, note history, computers panel, phone access pairing over pinned TLS, inert HTML, denied network, blocked script launch, draft recovery.`);
  console.log(`Screenshots: ${artifacts}`);
} finally { await application.close(); }
