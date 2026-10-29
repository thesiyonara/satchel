import { _electron as electron, expect } from '@playwright/test';
import path from 'node:path';
import { mkdir, readFile, rename as renameOnce } from 'node:fs/promises';
// Watchers and the index may hold a file inside the collection open for a moment; Windows then reports EBUSY.
async function rename(from, to) { for (let attempt = 0; ; attempt++) { try { return await renameOnce(from, to); } catch (error) { if (!['EBUSY', 'EPERM'].includes(error.code) || attempt >= 20) throw error; await new Promise(resolve => setTimeout(resolve, 250)); } } }
import assert from 'node:assert/strict';
const profile = path.resolve('.cache', `updates-ui-${Date.now()}`); await mkdir(profile, { recursive: true });
const application = await electron.launch({ args: ['.'], env: { ...process.env, SYNCIT_TEST_MODE: '1', SYNCIT_TEST_PROFILE: profile, SYNCIT_TEST_PORT: '22427', SYNCIT_TEST_HANDLE: '1' } });
try {
  const page = await application.firstWindow();
  await page.getByRole('button', { name: 'Create collection' }).click();
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().includes('handle=1') && !window.webContents.isLoading()))).toBe(true);
  assert.equal((await page.evaluate(() => window.syncit.updateState())).phase, 'idle');
  await page.getByRole('button', { name: 'Preferences', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'App updates' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Check daily/ })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Include preview/ })).not.toBeChecked();
  await page.screenshot({ path: path.resolve('test-results/update-settings.png') });
  await page.getByRole('button', { name: 'Close preferences' }).click();
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByLabel('Note text').fill('Must be saved before updating');
  // Exercise the real renderer save handshake, without starting an installer.
  const handshake = () => application.evaluate(async ({ ipcMain, BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows(); const id = 'test-update-handshake';
    const pending = new Set(windows.map(window => window.webContents.id));
    return await new Promise(resolve => {
      const timer = setTimeout(() => { ipcMain.removeListener('syncit:update-ready', handler); resolve(false); }, 8000);
      const handler = (event, nonce, ok) => { if (!pending.has(event.sender.id) || nonce !== id || event.senderFrame !== event.sender.mainFrame) return; pending.delete(event.sender.id); if (ok !== true || !pending.size) { clearTimeout(timer); ipcMain.removeListener('syncit:update-ready', handler); resolve(ok === true); } };
      ipcMain.on('syncit:update-ready', handler); windows.forEach(window => window.webContents.send('syncit:prepare-update', id, true));
    });
  });
  assert.equal(await handshake(), true);
  const library = await page.evaluate(() => window.syncit.list());
  assert.ok(library.items.some(item => item.preview === 'Must be saved before updating'));
  await expect(page.getByText('Preparing the update…')).toBeVisible();
  assert.equal(await page.locator('.app-frame').evaluate(element => element.inert), true); // the frame is the root that goes inert; the shell sits inside it
  const handle = application.windows().find(window => new URL(window.url()).searchParams.has('handle'));
  assert.ok(handle, 'A real drawer handle must participate in the handshake');
  await expect(handle.locator('.handle')).toHaveAttribute('inert', '');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.webContents.send('syncit:prepare-update', '', false)));
  await expect(handle.locator('.handle')).not.toHaveAttribute('inert', '');
  await expect(page.getByText('Preparing the update…')).not.toBeVisible();
  const root = path.join(profile, 'collection'), offline = path.join(profile, 'collection-offline');
  assert.ok(root.startsWith(profile + path.sep) && offline.startsWith(profile + path.sep));
  await rename(root, offline);
  try {
    await page.getByLabel('Note text').fill('Keep this buffer if an update cannot save it');
    assert.equal(await handshake(), false, 'A failed save must deny installation readiness');
    await expect(page.getByLabel('Note text')).toHaveValue('Keep this buffer if an update cannot save it');
  } finally {
    await rename(offline, root);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.webContents.send('syncit:prepare-update', '', false)));
  }
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.getByText('Saved on this computer')).toBeVisible();
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  assert.equal((await page.evaluate(() => window.syncit.updateState())).phase, 'idle', 'No check without opt-in or explicit action');
  const settings = JSON.parse(await readFile(path.join(profile, 'settings.json'), 'utf8')); assert.equal(settings.updateChecks, undefined);
  console.log('Update UI passed: manual defaults, preferences, all-window save acknowledgement with drawer handles, blocked editing, cancel recovery; no installer was launched.');
} finally { await application.close(); }
