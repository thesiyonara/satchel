// Phone access: an opt-in HTTPS service on the local network that lets a paired phone browse the
// collection, read and write notes, download files and upload photos on demand. The phone keeps no
// replica; the computers remain the only copies. Transport is TLS with a locally generated certificate
// whose SHA-256 fingerprint the phone pins at pairing time, so the self-signed certificate cannot be swapped.
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { X509Certificate, createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { generate } from 'selfsigned';
import type { PhoneDeviceInfo, PhoneOffer } from '../shared/types';
import type { Library } from './library';
import { localIPAllowed, localNetworks } from './sync-engine';
import { atomicWrite, contained, errorMessage, readJSON } from './files';
import { openRange, previewKind, streamable } from './media';

export interface PhoneDevice extends PhoneDeviceInfo { tokenHash: string }
export interface CompanionOptions {
  directory: string; port: number; allowLoopback?: boolean;
  /** Directory holding the web client (index.html, app.js, app.css, manifest.webmanifest, icon.png). */
  webRoot: string;
  library: () => Library; deviceName: () => string; collectionName: () => string; syncState: () => string;
  thumbnail: (relative: string, width?: number, height?: number) => Promise<Buffer>;
  text: (relative: string) => Promise<string>;
  changed?: () => void;
}
const PAIRING_TTL_MS = 5 * 60000;
const MAX_PAIRING_ATTEMPTS = 5;
const MAX_UPLOAD = 100 * 1024 * 1024;
const MAX_JSON = 2 * 1024 * 1024;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// The web client is a fixed set of files; nothing else under the web root is ever served.
const STATIC_FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' }, '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' }, '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
  '/manifest.webmanifest': { file: 'manifest.webmanifest', type: 'application/manifest+json' }, '/icon.png': { file: 'icon.png', type: 'image/png' },
  '/instrument-sans-latin.woff2': { file: 'instrument-sans-latin.woff2', type: 'font/woff2' }, '/instrument-sans-italic-latin.woff2': { file: 'instrument-sans-italic-latin.woff2', type: 'font/woff2' }
};
export const webCSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
const MEDIA_TICKET_TTL_MS = 10 * 60000;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
class RequestError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function ensureCertificate(directory: string): Promise<{ cert: string; key: string; fingerprint: string }> {
  const certFile = path.join(directory, 'phone-cert.pem'); const keyFile = path.join(directory, 'phone-key.pem');
  let cert: string; let key: string;
  try { [cert, key] = await Promise.all([fs.readFile(certFile, 'utf8'), fs.readFile(keyFile, 'utf8')]); }
  catch {
    const notBefore = new Date(); const notAfter = new Date(notBefore); notAfter.setFullYear(notAfter.getFullYear() + 10);
    const pems = await generate([{ name: 'commonName', value: 'Sync it phone access' }], { keyType: 'ec', curve: 'P-256', algorithm: 'sha256', notBeforeDate: notBefore, notAfterDate: notAfter, extensions: [{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true }, { name: 'extKeyUsage', serverAuth: true }] });
    cert = pems.cert; key = pems.private;
    await atomicWrite(keyFile, key); await atomicWrite(certFile, cert); // Temporary files are created with mode 0600.
  }
  return { cert, key, fingerprint: new X509Certificate(cert).fingerprint256 };
}
export function encodeOffer(offer: PhoneOffer) { return 'syncit-phone:' + Buffer.from(JSON.stringify(offer)).toString('base64url'); }
export function generateCode() { return Array.from(randomBytes(8), byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join(''); }

export class Companion {
  private server?: https.Server;
  private pairing?: { code: string; expires: number; attempts: number };
  private registry: PhoneDevice[] = [];
  private loaded = false;
  private lastSeenWrites = new Map<string, number>();
  // <video> and <audio> cannot send an Authorization header, so playback uses short-lived tickets bound to one path.
  private tickets = new Map<string, { path: string; expires: number }>();
  fingerprint = '';
  port: number;
  constructor(private options: CompanionOptions) { this.port = options.port; }
  get running() { return !!this.server; }
  get pairingActive() { return !!this.pairing && this.pairing.expires > Date.now(); }
  private get registryFile() { return path.join(this.options.directory, 'phone-devices.json'); }
  async devices(): Promise<PhoneDeviceInfo[]> { await this.load(); return this.registry.map(({ id, name, pairedAt, lastSeen }) => ({ id, name, pairedAt, lastSeen })); }
  private async load() {
    if (this.loaded) return;
    try { const stored = await readJSON<{ version: number; devices: PhoneDevice[] }>(this.registryFile); if (stored?.version === 1 && Array.isArray(stored.devices)) this.registry = stored.devices.filter(device => typeof device?.id === 'string' && /^[a-f0-9]{64}$/.test(device.tokenHash || '')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    this.loaded = true;
  }
  private async save(devices: PhoneDevice[]) {
    this.registry = devices;
    await atomicWrite(this.registryFile, JSON.stringify({ version: 1, devices }, null, 2));
    this.options.changed?.();
  }
  async start() {
    if (this.server) return;
    await this.load();
    const { cert, key, fingerprint } = await ensureCertificate(this.options.directory);
    this.fingerprint = fingerprint;
    const server = https.createServer({ cert, key, minVersion: 'TLSv1.2' }, (request, response) => {
      void this.handle(request, response).catch(error => {
        if (response.headersSent) { response.destroy(); return; }
        this.reply(response, error instanceof RequestError ? error.status : 400, { error: errorMessage(error) });
      });
    });
    server.requestTimeout = 15 * 60000; server.headersTimeout = 10000; server.maxConnections = 32;
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(this.port, '0.0.0.0', resolve); });
    const address = server.address(); if (address && typeof address === 'object') this.port = address.port;
    this.server = server;
  }
  async stop() {
    const server = this.server; if (!server) return;
    this.server = undefined; this.pairing = undefined;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  /** Start a five-minute, single-use pairing window and return what the phone needs: addresses, port, certificate fingerprint, the code, and the URL that pairs the web client. */
  offer(): { offer: PhoneOffer; encoded: string; url: string } {
    if (!this.server) throw new Error('Turn on phone access first');
    const code = generateCode();
    this.pairing = { code, expires: Date.now() + PAIRING_TTL_MS, attempts: 0 };
    const addresses = localNetworks(this.options.allowLoopback).addresses;
    const host = addresses[0] || (this.options.allowLoopback ? '127.0.0.1' : '');
    if (!host) throw new Error('This computer has no local network address to pair on');
    const url = `https://${host}:${this.port}/#pair=${code}`;
    const offer: PhoneOffer = { version: 1, name: this.options.deviceName(), addresses, port: this.port, fingerprint: this.fingerprint, code, expires: this.pairing.expires, url };
    return { offer, encoded: encodeOffer(offer), url };
  }
  private async serveStatic(pathname: string, response: ServerResponse) {
    const entry = STATIC_FILES[pathname];
    if (!entry) throw new RequestError(404, 'Unknown request');
    const bytes = await fs.readFile(path.join(this.options.webRoot, entry.file));
    response.writeHead(200, { 'Content-Type': entry.type, 'Content-Length': bytes.length, 'Content-Security-Policy': webCSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache' });
    response.end(bytes);
  }
  cancelPairing() { this.pairing = undefined; }
  async revoke(id: unknown) {
    await this.load();
    if (typeof id !== 'string' || !this.registry.some(device => device.id === id)) throw new Error('This phone is not paired');
    await this.save(this.registry.filter(device => device.id !== id));
  }
  private reply(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(body));
  }
  private async readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of request) { length += chunk.length; if (length > limit) { request.destroy(); throw new RequestError(413, `Request exceeds ${Math.round(limit / 1048576)} MB`); } chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  private async readJSONBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const text = (await this.readBody(request, MAX_JSON)).toString('utf8');
    let body: unknown; try { body = text ? JSON.parse(text) : {}; } catch { throw new RequestError(400, 'Send a JSON body'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError(400, 'Send a JSON object');
    return body as Record<string, unknown>;
  }
  private authenticate(request: IncomingMessage): PhoneDevice | undefined {
    const header = request.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!/^[a-f0-9]{64}$/.test(token)) return undefined;
    const digest = Buffer.from(hashToken(token));
    let found: PhoneDevice | undefined;
    for (const device of this.registry) { const candidate = Buffer.from(device.tokenHash); if (candidate.length === digest.length && timingSafeEqual(candidate, digest)) found = device; }
    return found;
  }
  private async touch(device: PhoneDevice) {
    const now = Date.now();
    if (now - (this.lastSeenWrites.get(device.id) || 0) < 60000) return;
    this.lastSeenWrites.set(device.id, now);
    await this.save(this.registry.map(entry => entry.id === device.id ? { ...entry, lastSeen: now } : entry)).catch(() => {});
  }
  private async handle(request: IncomingMessage, response: ServerResponse) {
    const remote = (request.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (!localIPAllowed(remote, this.options.allowLoopback)) throw new RequestError(403, 'Phone access only answers on the local network');
    await this.load();
    const url = new URL(request.url || '/', 'https://phone.local');
    if (request.method === 'GET' && !url.pathname.startsWith('/v1/')) return this.serveStatic(url.pathname, response);
    if (request.method === 'POST' && url.pathname === '/v1/pair') return this.pair(request, response);
    if (request.method === 'GET' && url.pathname === '/v1/stream') return this.stream(url, request, response);
    const device = this.authenticate(request);
    if (!device) throw new RequestError(401, 'Pair this phone with the computer first');
    void this.touch(device);
    const library = this.options.library();
    const relative = url.searchParams.get('path') || '';
    switch (`${request.method} ${url.pathname}`) {
      case 'GET /v1/status': return this.reply(response, 200, { deviceName: this.options.deviceName(), collection: this.options.collectionName(), state: this.options.syncState(), phone: { id: device.id, name: device.name }, phones: this.registry.length });
      case 'GET /v1/items': { const snapshot = await library.snapshot(); return this.reply(response, 200, { items: snapshot.items.map(item => ({ ...item, preview: item.preview?.slice(0, 400), previewKind: previewKind(item.name) })), placements: snapshot.placements, error: snapshot.error }); }
      case 'GET /v1/note': return this.reply(response, 200, await library.readNote(relative));
      case 'POST /v1/note': { const body = await this.readJSONBody(request); return this.reply(response, 201, await library.createNote(body.text as string | undefined)); }
      case 'PUT /v1/note': { const body = await this.readJSONBody(request); if (typeof body.revision !== 'string') throw new RequestError(400, 'A note revision is required'); return this.reply(response, 200, await library.saveNote(body.path as string, body.text as string, body.revision)); }
      case 'GET /v1/file': return this.sendFile(library, relative, response);
      case 'POST /v1/media-ticket': {
        const body = await this.readJSONBody(request);
        const target = await contained(library.root, body.path as string);
        if (!streamable(target)) throw new RequestError(400, 'Only images, video, audio and PDF files can be streamed');
        const now = Date.now();
        for (const [ticket, entry] of this.tickets) if (entry.expires < now) this.tickets.delete(ticket);
        if (this.tickets.size >= 200) throw new RequestError(429, 'Too many open media sessions');
        const ticket = randomBytes(16).toString('hex');
        this.tickets.set(ticket, { path: body.path as string, expires: now + MEDIA_TICKET_TTL_MS });
        return this.reply(response, 201, { url: `/v1/stream?ticket=${ticket}`, expires: now + MEDIA_TICKET_TTL_MS });
      }
      case 'GET /v1/thumbnail': { const png = await this.options.thumbnail(relative); response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }); response.end(png); return; }
      case 'GET /v1/preview': { const png = await this.options.thumbnail(relative, 1800, 1800); response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }); response.end(png); return; }
      case 'GET /v1/text': return this.reply(response, 200, { path: relative, text: await this.options.text(relative) });
      case 'POST /v1/upload': { const bytes = await this.readBody(request, MAX_UPLOAD); return this.reply(response, 201, { path: await library.addBytes(url.searchParams.get('name') || '', bytes) }); }
      case 'DELETE /v1/session': await this.save(this.registry.filter(entry => entry.id !== device.id)); return this.reply(response, 200, { ok: true });
      default: throw new RequestError(404, 'Unknown request');
    }
  }
  private async pair(request: IncomingMessage, response: ServerResponse) {
    const pairing = this.pairing;
    if (!pairing || pairing.expires < Date.now()) { this.pairing = undefined; throw new RequestError(403, 'No pairing in progress. Choose “Pair a phone” on the computer.'); }
    if (pairing.attempts >= MAX_PAIRING_ATTEMPTS) { this.pairing = undefined; throw new RequestError(429, 'Too many attempts. Start pairing again on the computer.'); }
    pairing.attempts++;
    const body = await this.readJSONBody(request);
    const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const name = String(body.name || '').replace(/[\x00-\x1f]/g, '').trim().slice(0, 60) || 'Phone';
    const expected = Buffer.from(pairing.code); const supplied = Buffer.from(code);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new RequestError(403, 'Wrong pairing code');
    const token = randomBytes(32).toString('hex');
    const device: PhoneDevice = { id: randomUUID(), name, tokenHash: hashToken(token), pairedAt: Date.now() };
    await this.save([...this.registry, device]);
    this.pairing = undefined;
    this.reply(response, 201, { token, id: device.id, deviceName: this.options.deviceName(), collection: this.options.collectionName(), fingerprint: this.fingerprint });
  }
  private async stream(url: URL, request: IncomingMessage, response: ServerResponse) {
    const ticket = url.searchParams.get('ticket') || '';
    const entry = /^[a-f0-9]{32}$/.test(ticket) ? this.tickets.get(ticket) : undefined;
    if (!entry || entry.expires < Date.now()) { this.tickets.delete(ticket); throw new RequestError(403, 'This media link has expired. Open the item again.'); }
    const target = await contained(this.options.library().root, entry.path);
    const range = await openRange(target, request.headers.range);
    response.writeHead(range.status, range.headers);
    if (!range.stream) { response.end(); return; }
    await new Promise<void>((resolve, reject) => { range.stream!.on('error', reject); response.on('close', () => resolve()); range.stream!.pipe(response); });
  }
  private async sendFile(library: Library, relative: string, response: ServerResponse) {
    const target = await contained(library.root, relative);
    const stat = await fs.lstat(target);
    if (!stat.isFile()) throw new RequestError(400, 'Only files can be downloaded');
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    await new Promise<void>((resolve, reject) => { const stream = createReadStream(target); stream.on('error', reject); response.on('close', () => resolve()); stream.pipe(response); });
  }
}
