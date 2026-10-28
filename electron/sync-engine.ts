import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs, createReadStream, constants as fsConstants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { NearbyDevice, PairingOptions, Settings, SyncStatus, IncomingItem } from '../shared/types';
import { atomicWrite, errorMessage } from './files';
import { secureDirectory } from './security';
import engineHashes from '../shared/engine-integrity.json';
import signedEngineHashes from '../shared/engine-signed-integrity.json';

const execFileAsync = promisify(execFile);
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Config = Record<string, any>;
export interface EngineOptions { executable: string; home: string; settings: () => Settings; updateSettings: (patch: Partial<Settings>) => Promise<void>; changed?: (status: SyncStatus) => void; arrived?: (items: { path: string; by: string }[]) => void; port?: number; allowLoopback?: boolean; discovery?: boolean; /** Test only: throttle what this instance receives, in KiB/s, so a transfer stays visible long enough to observe. */ recvLimitKbps?: number }
export interface PairingCode { version: 1; deviceId: string; folderId: string; name: string; port: number }
export const deviceIdPattern = /^[A-Z2-7]{7}(?:-[A-Z2-7]{7}){7}$/;
const folderIdPattern = /^[a-zA-Z0-9-]{1,80}$/;
/** An untrusted device stores and relays only data encrypted with this password; every trusted computer must use the same one for it. */
export function validateEncryptionPassword(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length < 8 || value.length > 128 || /[\x00-\x1f]/.test(value)) throw new Error('Use an encryption password between 8 and 128 characters');
  return value;
}
/** Accepts "192.168.1.5", "192.168.1.5:22027" or "tcp://192.168.1.5:22027" on an attached IPv4 network; returns a Syncthing address. */
export function parseLocalAddress(value: unknown, allowLoopback = false): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 64) throw new Error('Enter an IPv4 address on the same local network');
  const match = /^(?:tcp:\/\/)?(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/.exec(value.trim());
  const port = match?.[2] ? Number(match[2]) : 22027;
  if (!match || !localIPAllowed(match[1], allowLoopback) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Enter an IPv4 address on the same local network');
  return `tcp://${match[1]}:${port}`;
}
/** Share a folder with every configured device while keeping each device's existing per-folder settings (such as its encryption password). */
function shareWithDevices(folder: Config, devices: Config[], passwords: Record<string, string> = {}) {
  const existing = new Map<string, Config>((folder.devices || []).map((entry: Config) => [entry.deviceID, entry]));
  folder.devices = devices.map((device: Config) => {
    const entry: Config = { ...(existing.get(device.deviceID) || {}), deviceID: device.deviceID };
    if (passwords[device.deviceID] !== undefined) entry.encryptionPassword = passwords[device.deviceID];
    return entry;
  });
}
export function parsePairingCode(code: string): PairingCode {
  if (typeof code !== 'string' || code.length > 4096 || !code.trim().startsWith('syncit1:')) throw new Error('Paste the pairing code from your other computer');
  let parsed: PairingCode;
  try { parsed = JSON.parse(Buffer.from(code.trim().slice(8), 'base64url').toString('utf8')); } catch { throw new Error('Pairing code is invalid'); }
  if (!parsed || parsed.version !== 1 || typeof parsed.deviceId !== 'string' || !/^[A-Z2-7]{7}(?:-[A-Z2-7]{7}){7}$/.test(parsed.deviceId) || typeof parsed.folderId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(parsed.folderId) || typeof parsed.name !== 'string' || /[\x00-\x1f]/.test(parsed.name) || parsed.name.length > 100 || !Number.isInteger(parsed.port) || parsed.port < 1024 || parsed.port > 65535) throw new Error('Pairing code is invalid');
  return parsed;
}
export function localNetworks(allowLoopback = false): { addresses: string[]; networks: string[] } {
  const addresses: string[] = []; const networks: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) for (const entry of entries || []) {
    if (entry.internal || entry.family !== 'IPv4') continue;
    addresses.push(entry.address);
    const mask = entry.netmask.split('.').map(Number);
    const network = entry.address.split('.').map((part, index) => Number(part) & mask[index]).join('.');
    const bits = mask.reduce((sum, n) => sum + n.toString(2).replaceAll('0', '').length, 0);
    if (bits > 0) networks.push(`${network}/${bits}`);
  }
  if (allowLoopback) networks.push('127.0.0.0/8');
  return { addresses, networks: [...new Set(networks), '!0.0.0.0/0', '!::/0'] };
}
export function localIPAllowed(address: string, allowLoopback = false): boolean {
  if (net.isIP(address) !== 4) return false;
  const ip = address.split('.').reduce((n, x) => ((n << 8) | Number(x)) >>> 0, 0);
  return localNetworks(allowLoopback).networks.filter(n => !n.startsWith('!')).some(cidr => {
    const [base, length] = cidr.split('/');
    const network = base.split('.').reduce((n, x) => ((n << 8) | Number(x)) >>> 0, 0);
    const mask = (0xffffffff << (32 - Number(length))) >>> 0;
    return ((ip & mask) >>> 0) === ((network & mask) >>> 0);
  });
}
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = (server.address() as net.AddressInfo).port; server.close(error => error ? reject(error) : resolve(port)); });
  });
}
export class SyncEngine {
  status: SyncStatus = { state: 'starting', deviceId: '', peers: [], pending: [], nearby: [], pendingItems: 0, pendingBytes: 0, incoming: [], inRate: 0, localAddresses: [], errors: [], engineVersion: '2.1.7' };
  private child?: ChildProcess;
  private apiPort = 0;
  private apiKey = '';
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private healthyTimer?: ReturnType<typeof setTimeout>;
  private retries = 0;
  private starting?: Promise<void>;
  private refreshing = false;
  private configChain: Promise<unknown> = Promise.resolve();
  private networkSignature = '';
  private lastLog = '';
  private adopting = false;
  private active = true;
  constructor(private options: EngineOptions) {}
  /** Status listeners only hear about actual changes, so idle polling never wakes the renderer. */
  private emit(patch: Partial<SyncStatus>) {
    const next = { ...this.status, ...patch };
    const changed = JSON.stringify(next) !== JSON.stringify(this.status);
    this.status = next;
    if (changed) this.options.changed?.(this.status);
  }
  /** Poll quickly while a window is visible, slowly while the app only sits in the tray. */
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (active && this.child && !this.stopped) { void this.refresh(); this.poll(); }
  }
  async start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) return;
    this.stopped = false;
    this.starting = this.launch().finally(() => { this.starting = undefined; });
    return this.starting;
  }
  private async launch(lockAttempt = 0): Promise<void> {
    this.emit({ state: 'starting', errors: [] });
    try {
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(this.options.executable)) digest.update(chunk);
      const key = `${process.platform}-${process.arch}`;
      const expected = (signedEngineHashes as Record<string, string>)[key] || (engineHashes as Record<string, string>)[key];
      if (!expected || digest.digest('hex') !== expected) throw new Error('The sync helper failed its integrity check. Reinstall Satchel from a trusted build.');
      // Packaging or extraction can drop the execute bit on macOS; restore it for the verified helper only.
      if (process.platform !== 'win32') await fs.access(this.options.executable, fsConstants.X_OK).catch(() => fs.chmod(this.options.executable, 0o755));
      await secureDirectory(this.options.home);
      const filename = path.join(this.options.home, 'config.xml');
      try { await fs.access(filename); }
      catch { await execFileAsync(this.options.executable, ['generate', '--home', this.options.home, '--no-port-probing'], { windowsHide: true }); }
      const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false });
      const xml = parser.parse(await fs.readFile(filename, 'utf8'));
      const config = xml.configuration;
      await this.recoverOrphan(config.gui, filename);
      this.apiPort = await freePort(); this.apiKey = randomBytes(32).toString('hex');
      config.gui = { ...config.gui, '@_enabled': 'true', '@_tls': 'false', '@_sendBasicAuthPrompt': 'true', address: `127.0.0.1:${this.apiPort}`, apikey: this.apiKey, user: 'syncit-private', password: await bcrypt.hash(randomBytes(32).toString('hex'), 10), authMode: 'static', insecureAdminAccess: 'false', insecureSkipHostcheck: 'false', insecureAllowFrameLoading: 'false', metricsWithoutAuth: 'false' };
      config.options = { ...config.options, listenAddress: `tcp://0.0.0.0:${this.options.port ?? 22027}`, globalAnnounceEnabled: 'false', globalAnnounceServer: '', localAnnounceEnabled: String(this.options.discovery !== false), relaysEnabled: 'false', natEnabled: 'false', startBrowser: 'false', urAccepted: '-1', urURL: '', crashReportingEnabled: 'false', crashReportingURL: '', autoUpgradeIntervalH: '0', releasesURL: '', stunServer: '', reconnectionIntervalS: '5', progressUpdateIntervalS: '1', setLowPriority: 'false' };
      config.options.localAnnounceEnabled = String(this.options.discovery ?? this.options.settings().localDiscovery ?? true);
      const devices = Array.isArray(config.device) ? config.device : config.device ? [config.device] : [];
      const networks = localNetworks(this.options.allowLoopback).networks;
      for (const device of devices) device.allowedNetwork = networks;
      config.device = devices;
      await atomicWrite(filename, new XMLBuilder({ ignoreAttributes: false, format: true, suppressEmptyNode: false, suppressBooleanAttributes: false }).build(xml));
      if (this.stopped) return;
      this.lastLog = '';
      // The app supervises this pinned engine directly; skip Syncthing's extra monitor process.
      const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^ST[A-Z_]|^GODEBUG$/.test(name)));
      const child = spawn(this.options.executable, ['serve', '--home', this.options.home, '--no-browser', '--no-restart', '--no-upgrade', ...(process.platform === 'win32' ? ['--no-console'] : [])], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...cleanEnvironment, STNOUPGRADE: '1', STMONITORED: '1' } });
      this.child = child;
      const log = (chunk: Buffer) => { this.lastLog = (this.lastLog + chunk.toString()).slice(-6000); };
      child.stdout?.on('data', log); child.stderr?.on('data', log);
      child.on('error', error => this.emit({ state: 'error', errors: [errorMessage(error)] }));
      child.on('exit', () => {
        if (this.child === child) this.child = undefined;
        clearTimeout(this.healthyTimer);
        if (!this.stopped) {
          this.emit({ state: 'error', errors: ['Sync engine stopped. ' + this.lastLog.split('\n').filter(line => /ERR|FTL|FATAL|panic/i.test(line)).slice(-1).join('').slice(0, 400)] });
          if (!this.starting && this.retries < 3) { clearTimeout(this.timer); clearTimeout(this.restartTimer); this.restartTimer = setTimeout(() => { this.retries++; void this.start().catch(() => {}); }, 1500 * 2 ** this.retries); }
        }
      });
      let ready = false;
      for (let attempt = 0; attempt < 60 && !this.stopped; attempt++) {
        if (child.exitCode !== null) throw new Error('Sync engine could not start. ' + this.lastLog.slice(-500));
        try { await this.api('/system/ping'); ready = true; break; } catch { await pause(200); }
      }
      if (!ready) throw new Error('Sync engine did not respond');
      const system = await this.api('/system/status');
      this.emit({ deviceId: system.myID });
      await this.configure();
      await this.refresh();
      this.poll();
      // A minute of healthy running restores the restart budget, so an old crash does not disable supervision forever.
      clearTimeout(this.healthyTimer); this.healthyTimer = setTimeout(() => { this.retries = 0; }, 60000);
    } catch (error) {
      // The control socket closes before Syncthing finishes releasing its DB lock.
      // Retry startup for that specific race, without killing an unrelated process.
      if (!this.stopped && lockAttempt < 30 && /Failed to acquire lock/i.test(errorMessage(error))) {
        await pause(1000); return this.launch(lockAttempt + 1);
      }
      this.emit({ state: 'error', errors: [errorMessage(error)] }); throw error;
    }
  }
  async api(endpoint: string, method = 'GET', body?: unknown): Promise<any> {
    const response = await fetch(`http://127.0.0.1:${this.apiPort}/rest${endpoint}`, { method, headers: { 'X-API-Key': this.apiKey, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error(`Sync service: ${(await response.text()).slice(0, 250) || response.status}`);
    const text = await response.text(); return text ? JSON.parse(text) : undefined;
  }
  private async recoverOrphan(gui: Config, filename: string) {
    if (!/^127\.0\.0\.1:\d{1,5}$/.test(gui?.address || '') || typeof gui?.apikey !== 'string') return;
    const endpoint = `http://${gui.address}/rest`;
    const headers = { 'X-API-Key': gui.apikey };
    let response: Response;
    try { response = await fetch(endpoint + '/system/paths', { headers, signal: AbortSignal.timeout(1000) }); }
    catch (error) {
      if ((error as Error & { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED') return;
      throw new Error('The previous sync helper is not responding. Retry after it has stopped.');
    }
    // Ping becomes available before all REST routes during startup. Never rotate
    // credentials while a responding helper may still own this profile.
    for (let attempt = 0; !response.ok && attempt < 30; attempt++) {
      await pause(200);
      response = await fetch(endpoint + '/system/paths', { headers, signal: AbortSignal.timeout(1000) });
    }
    if (!response.ok) throw new Error(`Cannot authenticate the existing sync helper (${response.status}). Quit it before retrying.`);
    const paths = await response.json() as Record<string, string>;
    const normalize = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (typeof paths.config !== 'string' || normalize(paths.config) !== normalize(filename)) throw new Error('Another service is using this control port. Restart Satchel.');
    await fetch(endpoint + '/system/shutdown', { method: 'POST', headers, signal: AbortSignal.timeout(3000) });
    for (let attempt = 0; attempt < 60; attempt++) {
      await pause(100);
      try { await fetch(endpoint + '/system/ping', { headers, signal: AbortSignal.timeout(500) }); } catch { return; }
    }
    throw new Error('The previous sync helper has not stopped. Try again shortly.');
  }
  private mutate<T>(callback: (config: Config) => Promise<T>): Promise<T> {
    const run = this.configChain.then(async () => callback(await this.api('/config')));
    this.configChain = run.catch(() => {}); return run;
  }
  async configure(): Promise<void> {
    return this.mutate(async config => {
      const settings = this.options.settings();
      const networks = localNetworks(this.options.allowLoopback).networks;
      for (const device of config.devices) {
        device.allowedNetworks = networks;
        device.autoAcceptFolders = false;
        if (device.deviceID === this.status.deviceId) device.name = settings.deviceName;
        else device.paused = settings.syncPaused ?? false;
      }
      config.options.localAnnounceEnabled = this.options.discovery ?? settings.localDiscovery ?? true;
      // Progress once a second so an incoming file can be shown as it lands, and no lowered process priority: someone is usually waiting for the transfer.
      config.options.progressUpdateIntervalS = 1; config.options.setLowPriority = false;
      if (this.options.recvLimitKbps) { config.options.maxRecvKbps = this.options.recvLimitKbps; config.options.limitBandwidthInLan = true; }
      let folder = config.folders.find((entry: Config) => entry.id === settings.folderId);
      if (!folder) folder = { ...config.defaults.folder, id: settings.folderId, label: 'Satchel', path: settings.root };
      // The watcher plus the app's own scan requests catch changes; the hourly full rescan is a safety net, not the mechanism.
      Object.assign(folder, { path: settings.root, type: 'sendreceive', fsWatcherEnabled: true, fsWatcherDelayS: 0.5, rescanIntervalS: 3600, ignorePerms: true, maxConflicts: -1, paused: false, pullerMaxPendingKiB: 65536, minDiskFree: { value: 1, unit: '%' }, versioning: { type: 'staggered', params: { maxAge: String(30 * 86400) }, cleanupIntervalS: 3600, fsPath: '', fsType: 'basic' } });
      shareWithDevices(folder, config.devices);
      config.folders = [folder];
      folder.paused = settings.syncPaused ?? false;
      await this.api('/config', 'PUT', config);
      this.networkSignature = networks.join(',');
    });
  }
  private poll() {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      if (localNetworks(this.options.allowLoopback).networks.join(',') !== this.networkSignature) await this.configure().catch(error => this.emit({ state: 'error', errors: [errorMessage(error)] }));
      await this.refresh(); this.poll();
    }, this.active ? 1500 : 10000);
  }
  /** Files whose latest change came from another computer, by relative path, from the engine's RemoteChangeDetected events. */
  private arrivals = new Map<string, { at: number; by: string }>();
  private eventsAbort?: AbortController;
  private lastEvent = 0;
  arrival(relative: string) { const found = this.arrivals.get(relative.replace(/\\/g, '/')); return found && Date.now() - found.at < 172800000 ? found : undefined; }
  /** What the engine still needs from other computers (its need list) and how far each file has come (its DownloadProgress events). */
  private need: { path: string; size: number }[] = [];
  private progress = new Map<string, { done: number; total: number }>();
  private sources = new Map<string, string>();
  private lastIn?: { bytes: number; at: number };
  private incomingList(): IncomingItem[] {
    return this.need.map(entry => { const progress = this.progress.get(entry.path); return { path: entry.path, name: entry.path.split('/').pop() || entry.path, size: Math.max(entry.size, progress?.total ?? 0), done: Math.min(progress?.done ?? 0, entry.size || progress?.total || 0), from: this.sources.get(entry.path) }; })
      .sort((a, b) => (b.done > 0 ? 1 : 0) - (a.done > 0 ? 1 : 0) || b.size - a.size).slice(0, 40);
  }
  private watchEvents() {
    if (this.eventsAbort || this.stopped) return;
    const abort = this.eventsAbort = new AbortController();
    const loop = async () => {
      while (!this.stopped && this.eventsAbort === abort) {
        try {
          const response = await fetch(`http://127.0.0.1:${this.apiPort}/rest/events?events=RemoteChangeDetected,DownloadProgress&since=${this.lastEvent}&timeout=30`, { headers: { 'X-API-Key': this.apiKey }, signal: abort.signal });
          if (!response.ok) throw new Error(String(response.status));
          const events = await response.json() as { id: number; type: string; time: string; data?: Config }[];
          const folderId = this.options.settings().folderId;
          const fresh: { path: string; by: string }[] = [];
          let progressed = false;
          for (const event of events) {
            this.lastEvent = Math.max(this.lastEvent, event.id);
            if (event.type === 'DownloadProgress') {
              // Each event carries every file in flight; a file missing from it has finished or stopped.
              const files = (event.data?.[folderId] || {}) as Record<string, { bytesDone?: number; bytesTotal?: number }>;
              this.progress = new Map(Object.entries(files).map(([file, info]) => [file.replace(/\\/g, '/'), { done: info.bytesDone ?? 0, total: info.bytesTotal ?? 0 }]));
              progressed = true;
              continue;
            }
            if (!event.data || event.data.folder !== folderId || event.data.type !== 'file' || event.data.action === 'deleted') continue;
            // modifiedBy is the short device ID: the first group of the full one.
            const peer = this.status.peers.find(candidate => candidate.id === event.data!.modifiedBy || candidate.id.split('-')[0] === event.data!.modifiedBy);
            const entry = { path: event.data.path.replace(/\\/g, '/'), by: peer?.name || 'another computer' };
            this.arrivals.set(entry.path, { at: Date.parse(event.time) || Date.now(), by: entry.by });
            fresh.push(entry);
          }
          if (this.arrivals.size > 5000) for (const [key, value] of this.arrivals) { if (Date.now() - value.at > 172800000) this.arrivals.delete(key); }
          if (fresh.length) this.options.arrived?.(fresh);
          if (progressed && this.need.length) this.emit({ incoming: this.incomingList() });
        } catch { if (this.stopped || this.eventsAbort !== abort) return; await pause(3000); }
      }
    };
    void loop();
  }
  async refresh() {
    if (this.refreshing || this.stopped) return;
    this.refreshing = true;
    this.watchEvents();
    try {
      const folderId = this.options.settings().folderId;
      const folder = encodeURIComponent(folderId);
      const config = await this.api('/config');
      const localFolder = config.folders.find((entry: Config) => entry.id === folderId);
      const isPaused = !!localFolder?.paused;
      const discoveryOn = this.options.discovery ?? this.options.settings().localDiscovery ?? true;
      const [connections, pending, db, errors, offers, discovery] = await Promise.all([
        this.api('/system/connections'), this.api('/cluster/pending/devices'), isPaused ? Promise.resolve({}) : this.api(`/db/status?folder=${folder}`), isPaused ? Promise.resolve({}) : this.api(`/folder/errors?folder=${folder}`),
        this.api('/cluster/pending/folders').catch(() => ({})), discoveryOn ? this.api('/system/discovery').catch(() => ({})) : Promise.resolve({})
      ]);
      // Two computers that paired without a code each offer their own folder ID. Both adopt the
      // smaller one, so they converge on a single shared collection without deleting anything.
      const pairedIds = new Set<string>(config.devices.map((device: Config) => device.deviceID));
      let adopt: string | undefined;
      for (const [offeredId, info] of Object.entries(offers as Record<string, Config>)) {
        if (!folderIdPattern.test(offeredId) || offeredId === folderId || offeredId >= folderId) continue;
        if (Object.keys(info?.offeredBy || {}).some(id => pairedIds.has(id)) && (!adopt || offeredId < adopt)) adopt = offeredId;
      }
      if (adopt && !this.adopting) { this.adopting = true; void this.adoptFolder(adopt).catch(() => {}).finally(() => { this.adopting = false; }); }
      const known = new Set<string>([this.status.deviceId, ...pairedIds, ...(config.ignoredDevices || []).map((device: Config) => device.deviceID), ...Object.keys(pending)]);
      const nearby: NearbyDevice[] = Object.entries(discovery as Record<string, { addresses?: string[] }>)
        .filter(([id]) => deviceIdPattern.test(id) && !known.has(id))
        .map(([id, info]) => ({ id, addresses: (info?.addresses || []).filter(address => /^tcp:\/\/\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(address)).slice(0, 4) }))
        .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 20);
      let pendingItems = db.needTotalItems ?? 0; let pendingBytes = db.needBytes ?? 0;
      // The need list names the files on their way here. Directories, deletions and the folder marker are not arrivals.
      const needed = !isPaused && ((db.needTotalItems ?? 0) > 0 || (db.needBytes ?? 0) > 0) ? await this.api(`/db/need?folder=${folder}&page=1&perpage=40`).catch(() => ({})) : {};
      this.need = ([...(needed.progress || []), ...(needed.queued || []), ...(needed.rest || [])] as Config[])
        .filter(entry => entry?.name && !entry.deleted && !entry.invalid && !entry.ignored && !/DIR|SYMLINK/.test(String(entry.type ?? '')) && String(entry.type ?? '') !== '1' && String(entry.type ?? '') !== '4' && !/(^|\/)\.stfolder$/.test(entry.name))
        .map(entry => ({ path: String(entry.name).replace(/\\/g, '/'), size: Number(entry.size) || 0 }));
      for (const key of [...this.sources.keys()]) if (!this.need.some(entry => entry.path === key)) this.sources.delete(key);
      if (!this.need.length) this.progress.clear();
      const allErrors: string[] = (errors.errors || []).map((entry: Config) => `${entry.path}: ${entry.error}`);
      if (db.error) allErrors.push(db.error);
      const peers = await Promise.all(config.devices.filter((device: Config) => device.deviceID !== this.status.deviceId).map(async (device: Config) => {
        const connected = !!connections.connections?.[device.deviceID]?.connected;
        const completion = await this.api(`/db/completion?folder=${folder}&device=${device.deviceID}`).catch(() => ({ completion: 0, needItems: 0, needBytes: 0, remoteState: 'unknown' }));
        pendingItems += completion.needItems || 0; pendingBytes += completion.needBytes || 0;
        if (connected && completion.remoteState === 'notSharing') allErrors.push(`${device.name || 'Other computer'} has not accepted the collection yet.`);
        const encrypted = !!(localFolder?.devices || []).find((entry: Config) => entry.deviceID === device.deviceID)?.encryptionPassword;
        return { id: device.deviceID, name: device.name || 'Other computer', connected, completion: completion.completion ?? 0, encrypted };
      }));
      // Which computer holds each incoming file, for the first few; the answer is cached while the file stays on the list.
      await Promise.all(this.need.slice(0, 6).filter(entry => !this.sources.has(entry.path)).map(async entry => {
        const info = await this.api(`/db/file?folder=${folder}&file=${encodeURIComponent(entry.path)}`).catch(() => ({}));
        const holder = (info.availability as { id: string }[] | undefined || []).map(entry => peers.find(peer => peer.id === entry.id)).find(Boolean);
        if (holder) this.sources.set(entry.path, holder.name);
      }));
      const inBytes = Number(connections.total?.inBytesTotal) || 0; const now = Date.now();
      const inRate = this.lastIn && now > this.lastIn.at && inBytes >= this.lastIn.bytes ? (inBytes - this.lastIn.bytes) * 1000 / (now - this.lastIn.at) : 0;
      this.lastIn = { bytes: inBytes, at: now };
      const state = this.options.settings().syncPaused ? 'paused' : allErrors.length ? 'error' : !peers.length ? 'unpaired' : !peers.some(peer => peer.connected) ? 'offline' : pendingItems > 0 || ['scanning', 'syncing', 'scan-waiting', 'sync-waiting'].includes(db.state) || peers.some(peer => peer.connected && peer.completion < 100) ? 'syncing' : 'synced';
      this.emit({ state, peers, pending: Object.entries(pending).map(([id, value]) => ({ id, name: (value as Config).name || 'Nearby computer', address: (value as Config).address || '' })), nearby, pendingItems, pendingBytes, incoming: this.incomingList(), inRate: this.need.length ? Math.round(inRate) : 0, errors: allErrors, localAddresses: localNetworks().addresses });
    } catch (error) { this.emit({ state: 'error', errors: [errorMessage(error)] }); }
    finally { this.refreshing = false; }
  }
  pairingCode(): string {
    if (!this.status.deviceId) throw new Error('Wait for the sync engine to start');
    const settings = this.options.settings();
    return 'syncit1:' + Buffer.from(JSON.stringify({ version: 1, deviceId: this.status.deviceId, folderId: settings.folderId, name: settings.deviceName, port: this.options.port ?? 22027 } satisfies PairingCode)).toString('base64url');
  }
  async join(code: string, localIP?: string) {
    const remote = parsePairingCode(code);
    if (remote.deviceId === this.status.deviceId) throw new Error('That is this computer’s code. Use the code from the other computer.');
    if (localIP !== undefined && (typeof localIP !== 'string' || !localIPAllowed(localIP, this.options.allowLoopback))) throw new Error('Enter an IPv4 address on the same local network');
    await this.addDevice(remote.deviceId, { name: remote.name, address: localIP ? `tcp://${localIP}:${remote.port}` : undefined, folderId: remote.folderId });
    await this.refresh();
  }
  /** Pair with a device found on the local network (or entered by ID). The other computer still has to approve this one. */
  async connect(id: unknown, address?: unknown, options?: unknown) {
    if (typeof id !== 'string' || !deviceIdPattern.test(id)) throw new Error('Enter the other computer’s full device ID');
    if (id === this.status.deviceId) throw new Error('That is this computer’s ID. Use the ID shown on the other computer.');
    const password = validateEncryptionPassword((options as PairingOptions | undefined)?.encryptionPassword);
    await this.addDevice(id, { address: parseLocalAddress(address, this.options.allowLoopback), encryptionPassword: password });
    await this.refresh();
  }
  async approve(id: unknown, options?: unknown) {
    if (typeof id !== 'string' || !deviceIdPattern.test(id)) throw new Error('Invalid device ID');
    const password = validateEncryptionPassword((options as PairingOptions | undefined)?.encryptionPassword);
    const pending = await this.api('/cluster/pending/devices');
    if (!Object.hasOwn(pending, id)) throw new Error('This pairing request is no longer available');
    await this.addDevice(id, { name: pending[id].name, encryptionPassword: password });
    await this.refresh();
  }
  /** Add or update a device and share the collection with it in one config transaction. Never deletes or moves local files. */
  private async addDevice(id: string, details: { name?: string; address?: string; folderId?: string; encryptionPassword?: string }) {
    const oldId = this.options.settings().folderId;
    const folderId = details.folderId ?? oldId;
    await this.mutate(async config => {
      const previous = config.devices.find((device: Config) => device.deviceID === id);
      const device = { ...config.defaults.device, ...previous, deviceID: id, name: details.name ?? previous?.name ?? '', addresses: details.address ? [details.address, 'dynamic'] : previous?.addresses?.length ? previous.addresses : ['dynamic'], allowedNetworks: localNetworks(this.options.allowLoopback).networks, autoAcceptFolders: false, paused: false };
      config.ignoredDevices = (config.ignoredDevices || []).filter((entry: Config) => entry.deviceID !== id);
      config.devices = config.devices.filter((entry: Config) => entry.deviceID !== id).concat(device);
      config.folders = config.folders.map((entry: Config) => { const folder = { ...entry, id: folderId }; shareWithDevices(folder, config.devices, details.encryptionPassword !== undefined ? { [id]: details.encryptionPassword } : {}); return folder; });
      if (folderId !== oldId) await this.options.updateSettings({ folderId });
      try { await this.api('/config', 'PUT', config); }
      catch (error) { if (folderId !== oldId) await this.options.updateSettings({ folderId: oldId }); throw error; }
    });
  }
  /** Switch the local collection to a folder ID offered by a paired computer. The path and files stay where they are. */
  private async adoptFolder(folderId: string) {
    const oldId = this.options.settings().folderId;
    if (folderId === oldId) return;
    await this.mutate(async config => {
      config.folders = config.folders.map((entry: Config) => ({ ...entry, id: folderId }));
      await this.options.updateSettings({ folderId });
      try { await this.api('/config', 'PUT', config); }
      catch (error) { await this.options.updateSettings({ folderId: oldId }); throw error; }
    });
  }
  async reject(id: string) { await this.api(`/cluster/pending/devices?device=${encodeURIComponent(id)}`, 'DELETE'); await this.refresh(); }
  async revoke(id: string) {
    if (typeof id !== 'string' || !/^[A-Z2-7]{7}(?:-[A-Z2-7]{7}){7}$/.test(id) || id === this.status.deviceId) throw new Error('Invalid remote device');
    await this.mutate(async config => {
      if (!config.devices.some((device: Config) => device.deviceID === id)) throw new Error('This computer is not paired');
      config.devices = config.devices.filter((device: Config) => device.deviceID !== id);
      config.folders.forEach((folder: Config) => { folder.devices = folder.devices.filter((device: Config) => device.deviceID !== id); });
      config.ignoredDevices = [...(config.ignoredDevices || []).filter((device: Config) => device.deviceID !== id), { deviceID: id, name: '', time: new Date().toISOString() }];
      await this.api('/config', 'PUT', config);
    });
    await this.refresh();
  }
  async scan() { if (this.status.deviceId && !this.stopped) await this.api(`/db/scan?folder=${encodeURIComponent(this.options.settings().folderId)}`, 'POST').catch(() => {}); }
  async retry() { this.retries = 0; if (!this.child || this.child.exitCode !== null) await this.start(); else { await this.configure(); await this.scan(); await this.refresh(); } }
  async stop() {
    this.stopped = true; this.eventsAbort?.abort(); this.eventsAbort = undefined; clearTimeout(this.timer); clearTimeout(this.restartTimer); clearTimeout(this.healthyTimer);
    const child = this.child;
    if (!child) return;
    await this.api('/system/shutdown', 'POST').catch(() => {});
    for (let i = 0; i < 30 && child.exitCode === null && child.signalCode === null; i++) await pause(100);
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 5000);
        child.once('close', () => { clearTimeout(timer); resolve(); });
        child.kill();
      });
    }
    this.child = undefined;
  }
}
