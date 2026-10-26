import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { startControl } from '../electron/control';
import { validateSettingsPatch } from '../electron/settings';

test('local CLI authenticates, rejects browser origins and arbitrary operations, rotates credentials and cleans up', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'syncit-control-'));
  let close: (() => Promise<void>) | undefined;
  t.after(async () => { await close?.(); assert.ok(path.basename(root).startsWith('syncit-control-')); await fs.rm(root, { recursive: true, force: true }); });
  let calls = 0;
  const handlers = new Map([['echo', (...args: unknown[]) => { calls++; return args; }]]);
  close = await startControl(root, handlers);
  const config = JSON.parse(await fs.readFile(path.join(root, 'control.json'), 'utf8'));
  const endpoint = `http://127.0.0.1:${config.port}/command`;
  const headers = { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' };
  const body = JSON.stringify({ command: 'echo', args: ['hello'] });
  assert.equal((await fetch(endpoint, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } })).status, 403);
  assert.equal((await fetch(endpoint, { method: 'POST', body, headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
  const wrongHost = await new Promise<number | undefined>((resolve, reject) => { const request = http.request(endpoint, { method: 'POST', headers: { ...headers, Host: 'evil.test' } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); request.end(body); });
  assert.equal(wrongHost, 403);
  assert.equal(calls, 0);
  const result = await fetch(endpoint, { method: 'POST', body, headers });
  assert.deepEqual(await result.json(), { ok: true, result: ['hello'] });
  for (const invalid of [{ command: 'eval', args: ['process.exit()'] }, { command: '__proto__', args: [] }, { command: 'echo', args: 'wrong' }]) assert.equal((await fetch(endpoint, { method: 'POST', body: JSON.stringify(invalid), headers })).status, 400);
  assert.equal(calls, 1);
  await close(); close = undefined;
  await assert.rejects(fs.access(path.join(root, 'control.json')));
  close = await startControl(root, handlers);
  const next = JSON.parse(await fs.readFile(path.join(root, 'control.json'), 'utf8'));
  assert.notEqual(next.token, config.token);
});
test('floating preferences enforce safe enums and opacity bounds', () => {
  assert.deepEqual(validateSettingsPatch({ panelMode: 'mini', panelOpacity: .75, panelAutoHide: true }), { panelMode: 'mini', panelOpacity: .75, panelAutoHide: true });
  for (const patch of [{ panelMode: 'shell' }, { panelOpacity: .1 }, { panelOpacity: NaN }, { panelOpacity: '1' }, { panelAutoHide: 1 }, { favorites: ['../../secret'] }]) assert.throws(() => validateSettingsPatch(patch));
});
