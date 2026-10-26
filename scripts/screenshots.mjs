// Captures the README screenshots from a throwaway profile with neutral names. Opens real windows.
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
const profile = path.resolve('.cache', `screenshots-${Date.now()}`);
const output = path.resolve('docs', 'screenshots');
await mkdir(profile, { recursive: true }); await mkdir(output, { recursive: true });
async function demoScreenshot(page, name) {
  // Project demo values into the captured UI; never publish real LAN addresses,
  // hostnames, profile paths or even a disposable instance's device identifier.
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      node.textContent = (node.textContent || '')
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '192.0.2.10')
        .replace(/\b[A-Z2-7]{7}(?:-[A-Z2-7]{7}){7}\b/g, 'AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA')
        .replace(/[A-Z]:[\\/]Users[\\/][^\\/\s]+/gi, 'C:/Users/example');
    }
  });
  await page.screenshot({ path: path.join(output, name) });
}
const application = await electron.launch({ args: ['.'], env: { ...process.env, SYNCIT_TEST_MODE: '1', SYNCIT_TEST_PROFILE: profile, SYNCIT_TEST_PORT: '22727' } });
try {
  const page = await application.firstWindow();
  await page.getByRole('button', { name: 'Create collection' }).click();
  await page.evaluate(async () => {
    await window.syncit.settings({ deviceName: 'Studio' });
    await window.syncit.createNote('# Reading list\n\nA quiet book for the train.\nThe essay a friend recommended.\nSomething short before bed.');
    await window.syncit.createNote('Kitchen notes\n\n- Soak the beans overnight\n- Slow simmer, no lid\n- Salt at the end');
    await window.syncit.createNote('Workshop\n\nMeasure the alcove twice. The shelf brackets are in the blue box.');
    await window.syncit.createNote('# Trip plan\n\n**Friday** leave after lunch\n**Saturday** the coast road\n\n> Pack the good camera.');
  });
  await page.evaluate(async image => { await window.syncit.importFiles([image]); }, path.resolve('assets/icon.png'));
  await expect(page.locator('[data-testid="item-card"]')).toHaveCount(5);
  if (await page.getByRole('button', { name: 'Dismiss message' }).isVisible()) await page.getByRole('button', { name: 'Dismiss message' }).click();
  await demoScreenshot(page, 'dashboard.png');
  const paths = await page.locator('[data-testid="item-card"]').evaluateAll(cards => cards.map(card => card.getAttribute('data-path')));
  await page.evaluate(async paths => { for (const [i, p] of paths.slice(0, 3).entries()) await window.syncit.place({ version: 1, path: p, x: 40 + i * 300, y: 40 + i % 2 * 90, width: 260, height: 280, updatedAt: Date.now() }); }, paths);
  await page.getByRole('button', { name: 'Pinboard view', exact: true }).click();
  await expect(page.locator('.board-card')).toHaveCount(3);
  await demoScreenshot(page, 'pinboard.png');
  await page.getByRole('button', { name: 'Grid view', exact: true }).click();
  await page.locator('[data-testid="item-card"]', { hasText: 'Trip plan' }).getByRole('button', { name: /^Open / }).click();
  await page.getByRole('button', { name: 'Preview Markdown' }).click();
  await demoScreenshot(page, 'note.png');
  await page.getByRole('button', { name: 'Close note', exact: true }).click();
  await page.getByRole('button', { name: 'Open Quick drop', exact: true }).click();
  const panel = await expect.poll(async () => (await application.windows()).length).toBe(2).then(async () => (await application.windows()).find(p => p !== page));
  await expect(panel.getByRole('heading', { name: 'Add to the collection' })).toBeVisible();
  await demoScreenshot(panel, 'quick-drop.png');
  await page.getByRole('button', { name: 'Not paired yet', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Nearby' })).toBeVisible();
  await demoScreenshot(page, 'computers.png');
  await page.getByRole('button', { name: 'Close settings' }).click();
  console.log('Screenshots written to docs/screenshots.');
} finally { await application.close(); await rm(profile, { recursive: true, force: true }).catch(() => {}); }
