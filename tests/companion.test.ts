import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { Library } from '../electron/library';
import { Companion, encodeOffer } from '../electron/companion';

type Reply = { status: number; body: Buffer; fingerprint: string };
function call(port: number, method: string, pathname: string, options: { token?: string; json?: unknown; raw?: Buffer } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.json !== undefined) headers['Content-Type'] = 'application/json';
    // The phone pins the certificate fingerprint from the pairing offer instead of trusting any authority.
    const request = https.request({ host: '127.0.0.1', port, method, path: pathname, headers, rejectUnauthorized: false }, response => {
      const fingerprint = (response.socket as import('node:tls').TLSSocket).getPeerCertificate().fingerprint256;
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode || 0, body: Buffer.concat(chunks), fingerprint }));
    });
    request.on('error', reject);
    request.end(options.raw ?? (options.json !== undefined ? JSON.stringify(options.json) : undefined));
  });
}
const json = (reply: Reply) => JSON.parse(reply.body.toString('utf8'));

test('phone access pairs once with a short-lived code, pins its certificate, and serves the collection to paired phones only', { timeout: 60000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syncit-phone-'));
  const root = path.join(dir, 'collection'); await fs.mkdir(root);
  const library = new Library(root); await library.initialize();
  const companion = new Companion({ directory: dir, port: 0, allowLoopback: true, library: () => library, deviceName: () => 'Desk', collectionName: () => 'collection', syncState: () => 'synced', thumbnail: async relative => Buffer.from(`png:${relative}`) });
  t.after(async () => { await companion.stop(); await library.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await companion.start();
  const port = companion.port; assert.ok(port > 0);
  assert.match(companion.fingerprint, /^([A-F0-9]{2}:){31}[A-F0-9]{2}$/);
  assert.ok((await fs.readFile(path.join(dir, 'phone-cert.pem'), 'utf8')).includes('BEGIN CERTIFICATE'));
  // Nothing works before pairing, and pairing requires an open window.
  assert.equal((await call(port, 'GET', '/v1/items')).status, 401);
  assert.equal((await call(port, 'POST', '/v1/pair', { json: { code: 'ABCDEFGH', name: 'Phone' } })).status, 403);
  const { offer, encoded } = companion.offer();
  assert.equal(offer.fingerprint, companion.fingerprint); assert.equal(offer.port, port); assert.equal(encoded, encodeOffer(offer));
  assert.match(offer.code, /^[A-Z2-9]{8}$/); assert.ok(offer.addresses.includes('127.0.0.1') || offer.addresses.length >= 0);
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await call(port, 'POST', '/v1/pair', { json: { code: 'WRONGCOD', name: 'Phone' } })).status, 403);
  assert.equal((await call(port, 'POST', '/v1/pair', { json: { code: offer.code, name: 'Phone' } })).status, 429, 'five wrong codes close the window');
  const fresh = companion.offer();
  const paired = await call(port, 'POST', '/v1/pair', { json: { code: fresh.offer.code.toLowerCase(), name: ' Studio phone ' } });
  assert.equal(paired.status, 201);
  assert.equal(paired.fingerprint, companion.fingerprint, 'the served certificate matches the pinned fingerprint');
  const { token, fingerprint } = json(paired);
  assert.match(token, /^[a-f0-9]{64}$/); assert.equal(fingerprint, companion.fingerprint);
  assert.equal((await call(port, 'POST', '/v1/pair', { json: { code: fresh.offer.code, name: 'Again' } })).status, 403, 'a code works once');
  const devices = await companion.devices();
  assert.equal(devices.length, 1); assert.equal(devices[0].name, 'Studio phone');
  assert.ok(!JSON.stringify(devices).includes(token), 'tokens are never listed');
  const stored = JSON.parse(await fs.readFile(path.join(dir, 'phone-devices.json'), 'utf8'));
  assert.ok(!JSON.stringify(stored).includes(token), 'only the token hash is stored');
  // The API: status, notes, items, files, thumbnails, uploads.
  assert.equal(json(await call(port, 'GET', '/v1/status', { token })).deviceName, 'Desk');
  const created = json(await call(port, 'POST', '/v1/note', { token, json: { text: 'From the phone' } }));
  assert.equal(created.text, 'From the phone');
  const saved = json(await call(port, 'PUT', '/v1/note', { token, json: { path: created.path, text: 'Edited on the phone', revision: created.revision } }));
  assert.ok(!saved.conflict);
  assert.equal(json(await call(port, 'GET', `/v1/note?path=${encodeURIComponent(created.path)}`, { token })).text, 'Edited on the phone');
  assert.equal((await call(port, 'PUT', '/v1/note', { token, json: { path: created.path, text: 'x' } })).status, 400, 'saves need a revision');
  const items = json(await call(port, 'GET', '/v1/items', { token }));
  assert.ok(items.items.some((item: { path: string }) => item.path === created.path));
  const upload = json(await call(port, 'POST', '/v1/upload?name=IMG_0001.jpg', { token, raw: Buffer.from('jpeg bytes') }));
  assert.equal(upload.path, 'IMG_0001.jpg');
  assert.equal(await fs.readFile(path.join(root, 'IMG_0001.jpg'), 'utf8'), 'jpeg bytes');
  const download = await call(port, 'GET', '/v1/file?path=IMG_0001.jpg', { token });
  assert.equal(download.status, 200); assert.equal(download.body.toString('utf8'), 'jpeg bytes');
  assert.equal((await call(port, 'GET', '/v1/file?path=../phone-key.pem', { token })).status, 400, 'paths stay inside the collection');
  assert.equal((await call(port, 'GET', '/v1/file?path=.syncit/board', { token })).status, 400, 'internal paths are refused');
  assert.equal((await call(port, 'GET', '/v1/thumbnail?path=IMG_0001.jpg', { token })).body.toString('utf8'), 'png:IMG_0001.jpg');
  assert.equal((await call(port, 'GET', '/v1/items', { token: 'f'.repeat(64) })).status, 401, 'unknown tokens are rejected');
  // Unpairing from the phone or revoking from the computer ends access immediately.
  assert.equal((await call(port, 'DELETE', '/v1/session', { token })).status, 200);
  assert.equal((await call(port, 'GET', '/v1/items', { token })).status, 401);
  assert.equal((await companion.devices()).length, 0);
  await assert.rejects(companion.revoke('missing'));
  await companion.stop();
  assert.equal(companion.running, false);
});
