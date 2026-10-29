// In-app updates from the project's public GitHub releases. The app asks the releases API for the
// newest compatible version, downloads the installer and the release's SHA256SUMS file over HTTPS,
// verifies the installer against it, and only then offers to open it. No account, token or CLI is involved.
import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { errorMessage } from './files';
import type { UpdateState } from '../shared/types';
import { releasesAPI, repository, version as appVersion } from '../shared/project';

const MAX_INSTALLER = 600 * 1024 * 1024;
const MAX_CHECKSUMS = 16384;
const MAX_RELEASE_LIST = 4 * 1024 * 1024;
const downloadPrefix = `https://github.com/${repository}/releases/download/`;

export interface ReleaseClient {
  /** GET a JSON document. Rejects with an error carrying `status` on HTTP failure. */
  json(url: string, signal: AbortSignal): Promise<unknown>;
  /** GET `url` into a new file at `file`, refusing more than `limit` bytes. `progress` is told the bytes written and the declared total (0 when unknown). */
  download(url: string, file: string, limit: number, signal: AbortSignal, progress?: (done: number, total: number) => void): Promise<void>;
}
export class HttpError extends Error { constructor(public status: number, url: string) { super(`HTTP ${status} for ${url}`); } }

export function versionTuple(version: string) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
  return version.split('.').map(Number);
}
export function newer(a: string, b: string) { const x = versionTuple(a), y = versionTuple(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; }
// Matches electron-builder's artifactName "Satchel-${version}-${os}-${arch}.${ext}" (os is "win" or "mac").
// On a Mac the zip archive is used rather than the disk image: the app unpacks it and swaps the bundle in place.
export function installerName(version: string, platform: string, arch: string) {
  return platform === 'darwin' ? `Satchel-${version}-mac-${arch}.zip` : `Satchel-${version}-win-${arch}.exe`;
}
export interface SelectedRelease { version: string; tag: string; filename: string; checksum: string; installerURL: string; checksumURL: string }
/** The newest release that is newer than `current`, not a draft, allowed by the preview setting, and ships both this platform's package and the checksum file. */
export function selectRelease(releases: unknown, current: string, previews: boolean, arch: string, platform = 'win32'): SelectedRelease | null {
  if (!Array.isArray(releases)) throw new Error('Invalid release list');
  const asset = (release: any, name: string, limit: number) => {
    const entry = Array.isArray(release.assets) ? release.assets.find((a: any) => a?.name === name) : undefined;
    if (!entry || typeof entry.browser_download_url !== 'string' || !entry.browser_download_url.startsWith(downloadPrefix) || !(entry.size > 0) || entry.size > limit) return undefined;
    return entry.browser_download_url as string;
  };
  return releases
    .filter(r => r && !r.draft && (previews || !r.prerelease) && typeof r.tag_name === 'string' && /^v\d+\.\d+\.\d+$/.test(r.tag_name) && newer(r.tag_name.slice(1), current))
    .sort((a, b) => newer(a.tag_name.slice(1), b.tag_name.slice(1)) ? -1 : 1)
    .map(r => {
      const version = r.tag_name.slice(1); const filename = installerName(version, platform, arch); const checksum = `SHA256SUMS-${version}.txt`;
      const installerURL = asset(r, filename, MAX_INSTALLER); const checksumURL = asset(r, checksum, MAX_CHECKSUMS);
      return installerURL && checksumURL ? { version, tag: r.tag_name, filename, checksum, installerURL, checksumURL } : null;
    })
    .find(Boolean) || null;
}
export async function verifyInstaller(file: string, checksumFile: string, filename: string) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > MAX_INSTALLER) throw new Error('Invalid downloaded installer');
  if ((await fs.stat(checksumFile)).size > MAX_CHECKSUMS) throw new Error('Invalid checksum file');
  const lines = (await fs.readFile(checksumFile, 'utf8')).split(/\r?\n/).filter(Boolean);
  const records = lines.map(line => line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)).filter(match => match?.[2] === filename);
  if (records.length !== 1) throw new Error('Missing or ambiguous installer checksum');
  const digest = createHash('sha256'); for await (const chunk of createReadStream(file)) digest.update(chunk);
  if (digest.digest('hex') !== records[0]![1].toLowerCase()) throw new Error('Installer checksum mismatch. Download it again.');
}
/** Turn a network failure into one actionable sentence. */
export function describeFailure(error: unknown): string {
  const detail = error as Error & { status?: number; code?: string; cause?: { code?: string } };
  if (detail?.name === 'AbortError') return 'The update request was cancelled.';
  if (detail?.name === 'TimeoutError') return 'GitHub did not answer in time. Check your internet connection and retry.';
  if (detail instanceof HttpError) {
    if (detail.status === 403 || detail.status === 429) return 'GitHub is limiting requests from this network right now. Try again in a few minutes.';
    if (detail.status === 404) return 'The releases page was not found. Open the releases page in the browser to check.';
    return `GitHub answered with HTTP ${detail.status}. Try again later.`;
  }
  const code = detail?.code || detail?.cause?.code || '';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|CERT|TLS/i.test(code) || /fetch failed/i.test(detail?.message || '')) return 'GitHub is unreachable. Check your internet connection and retry.';
  return detail?.message || 'The update request failed.';
}
export const githubClient: ReleaseClient = {
  async json(url, signal) {
    const response = await fetch(url, { signal, redirect: 'follow', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': `Satchel/${appVersion}` } });
    if (!response.ok) throw new HttpError(response.status, url);
    const text = await response.text();
    if (text.length > MAX_RELEASE_LIST) throw new Error('The release list is unexpectedly large');
    return JSON.parse(text);
  },
  async download(url, file, limit, signal, progress) {
    if (!url.startsWith(downloadPrefix)) throw new Error('Refusing to download from outside the project releases');
    const response = await fetch(url, { signal, redirect: 'follow', headers: { 'User-Agent': `Satchel/${appVersion}` } });
    if (!response.ok || !response.body) throw new HttpError(response.status, url);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > limit) throw new Error('The download is larger than allowed');
    const handle = await fs.open(file, 'wx', 0o600);
    let total = 0;
    try {
      for await (const chunk of response.body as AsyncIterable<Uint8Array>) { total += chunk.length; if (total > limit) throw new Error('The download is larger than allowed'); await handle.write(chunk); progress?.(total, declared); }
      await handle.sync();
    } finally { await handle.close(); }
  }
};
export class Updates {
  state: UpdateState;
  private release: SelectedRelease | null = null;
  private directory = '';
  private busy = false;
  private abort = new AbortController();
  private pending?: Promise<unknown>;
  constructor(private home: string, private current: string, private changed: (state: UpdateState) => void, private platform = process.platform, private arch = process.arch, private client: ReleaseClient = githubClient) {
    this.state = { phase: 'idle', currentVersion: current };
  }
  private emit(patch: Partial<UpdateState>) { this.state = { ...this.state, ...patch }; this.changed(this.state); return this.state; }
  private run<T>(task: (signal: AbortSignal) => Promise<T>, timeout: number): Promise<T> {
    const promise = task(AbortSignal.any([this.abort.signal, AbortSignal.timeout(timeout)]));
    this.pending = promise.catch(() => {}); return promise;
  }
  async stop() { this.abort.abort(); await this.pending; }
  /** Downloads are trusted only in the session that verified them; remove leftovers from earlier sessions. */
  async clean() {
    if (this.busy || this.directory) return;
    await fs.rm(path.join(this.home, 'updates'), { recursive: true, force: true }).catch(() => {});
  }
  async check(previews: boolean) {
    if (this.busy) return this.state;
    if (this.state.phase === 'ready') return this.state;
    if (!['win32', 'darwin'].includes(this.platform)) return this.emit({ phase: 'unsupported', message: 'In-app updates support Windows and macOS. Use the releases page on other systems.' });
    this.busy = true; this.emit({ phase: 'checking', message: undefined, availableVersion: undefined });
    try {
      const releases = await this.run(signal => this.client.json(`${releasesAPI}?per_page=30`, signal), 30000);
      this.release = selectRelease(releases, this.current, previews, this.arch, this.platform);
      return this.emit({ phase: this.release ? 'available' : 'current', availableVersion: this.release?.version, checkedAt: Date.now() });
    } catch (error) { return this.emit({ phase: 'error', message: describeFailure(error) }); }
    finally { this.busy = false; }
  }
  async download() {
    if (this.busy) return this.state;
    if (!this.release || !['available', 'error'].includes(this.state.phase)) throw new Error('Check for an update first');
    const release = this.release;
    this.busy = true; this.emit({ phase: 'downloading', message: `Downloading Satchel ${release.version} from GitHub…` });
    try {
      const base = path.join(this.home, 'updates'); await fs.mkdir(base, { recursive: true });
      this.directory = await fs.mkdtemp(path.join(base, 'download-'));
      await this.run(signal => this.client.download(release.checksumURL, path.join(this.directory, release.checksum), MAX_CHECKSUMS, signal), 60000);
      let shown = -1;
      const progress = (done: number, total: number) => { if (!total) return; const share = Math.min(1, done / total); if (share - shown >= 0.01 || share === 1) { shown = share; this.emit({ progress: share }); } };
      await this.run(signal => this.client.download(release.installerURL, path.join(this.directory, release.filename), MAX_INSTALLER, signal, progress), 20 * 60 * 1000);
      await verifyInstaller(path.join(this.directory, release.filename), path.join(this.directory, release.checksum), release.filename);
      return this.emit({ phase: 'ready', progress: undefined, message: this.platform === 'darwin' ? 'Download verified. Install replaces Satchel in place and relaunches it.' : 'Download verified. Install runs the installer and relaunches Satchel.' });
    } catch (error) {
      const base = path.resolve(this.home, 'updates');
      if (this.directory && path.resolve(this.directory).startsWith(base + path.sep)) await fs.rm(this.directory, { recursive: true, force: true }).catch(() => {});
      this.directory = ''; return this.emit({ phase: 'error', progress: undefined, message: describeFailure(error) });
    } finally { this.busy = false; }
  }
  /**
   * macOS: unpack the verified archive next to the download and swap the fresh bundle in for the running one. The old bundle is parked in the
   * updates directory, which the next start removes. When the swap is not possible (the app runs from a temporary location, the bundle is not
   * writable, or a rename fails), everything is put back and the unpacked app is handed over so the person can drag it to Applications.
   */
  async replaceBundle(archive: string, bundle: string, tools: { unpack: (archive: string, into: string) => Promise<void>; copy: (from: string, to: string) => Promise<void> }): Promise<{ replaced: boolean; app: string; reason?: string }> {
    const staging = path.join(path.dirname(archive), 'unpacked');
    await fs.rm(staging, { recursive: true, force: true }); await fs.mkdir(staging);
    await tools.unpack(archive, staging);
    const fresh = path.join(staging, path.basename(bundle));
    if (!(await fs.stat(path.join(fresh, 'Contents', 'Info.plist')).catch(() => null))?.isFile()) throw new Error('The downloaded package does not contain the app');
    if (!bundle.endsWith('.app') || /\/AppTranslocation\//.test(bundle) || /^\/Volumes\//.test(bundle)) return { replaced: false, app: fresh, reason: 'Satchel is running from a temporary location rather than Applications' };
    const incoming = bundle + '.incoming'; const parked = path.join(path.dirname(archive), 'previous');
    await fs.rm(incoming, { recursive: true, force: true }); await fs.rm(parked, { recursive: true, force: true });
    try { await fs.rename(fresh, incoming); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') return { replaced: false, app: fresh, reason: errorMessage(error) };
      try { await tools.copy(fresh, incoming); } catch (copyError) { await fs.rm(incoming, { recursive: true, force: true }); return { replaced: false, app: fresh, reason: errorMessage(copyError) }; }
    }
    try { await fs.rename(bundle, parked); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EXDEV') { try { await tools.copy(bundle, parked); await fs.rm(bundle, { recursive: true, force: true }); } catch (copyError) { await fs.rename(incoming, fresh).catch(() => {}); return { replaced: false, app: fresh, reason: errorMessage(copyError) }; } }
      else { await fs.rename(incoming, fresh).catch(() => {}); return { replaced: false, app: fresh, reason: errorMessage(error) }; }
    }
    try { await fs.rename(incoming, bundle); }
    catch (error) { await fs.rename(parked, bundle).catch(() => {}); await fs.rename(incoming, fresh).catch(() => {}); return { replaced: false, app: fresh, reason: errorMessage(error) }; }
    return { replaced: true, app: bundle };
  }
  async installer() {
    if (this.state.phase !== 'ready' || !this.release || !this.directory) throw new Error('Download and verify an update first');
    const file = path.join(this.directory, this.release.filename);
    await verifyInstaller(file, path.join(this.directory, this.release.checksum), this.release.filename);
    return file;
  }
}
