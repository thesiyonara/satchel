import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import chokidar, { type FSWatcher } from 'chokidar';
import type { BoardPlacement, LibraryItem, LibrarySnapshot, NoteDocument, NoteVersion } from '../shared/types';
import { atomicWrite, cleanName, contained, errorMessage, hash, isInternal, linkOrClaim, safeRelative } from './files';
import { mediaKind } from './media';

const NOTE_LIMIT = 1024 * 1024;
export const RECOVERY_KEEP_PER_NOTE = 20;
export const RECOVERY_MAX_AGE_MS = 30 * 86400 * 1000;
const recoveryPattern = /^(.*)-(\d{13})-[a-f0-9]{6}\.md$/;
const RESCAN_INTERVAL_MS = 10 * 60000;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export class Library {
  private watcher?: FSWatcher;
  private timer?: ReturnType<typeof setTimeout>;
  private chain: Promise<unknown> = Promise.resolve();
  // Incremental index: built by one walk, then kept current from watcher events and the app's own
  // writes. A periodic full rescan and any watcher error rebuild it, so drift cannot persist.
  private index?: Map<string, LibraryItem>;
  private indexChain: Promise<unknown> = Promise.resolve();
  private rescanTimer?: ReturnType<typeof setInterval>;
  constructor(public root: string, private changed: () => void = () => {}, private recycle: (file: string) => Promise<void> = async () => { throw new Error('Trash is unavailable'); }, private recoveryDirectory?: string) {}
  async initialize() {
    if (!(await fs.lstat(this.root)).isDirectory()) throw new Error('Collection folder is unavailable');
    const metadata = await contained(this.root, '.syncit/board', true);
    await fs.mkdir(metadata, { recursive: true });
    const ignore = await contained(this.root, '.stignore', true);
    const existing = await fs.readFile(ignore, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error; });
    const rules = ['(?d).syncit-tmp-*', '.DS_Store', 'Thumbs.db'];
    const missing = rules.filter(rule => !existing.split(/\r?\n/).includes(rule));
    if (missing.length) await atomicWrite(ignore, existing + '\n' + missing.join('\n') + '\n');
    this.watcher = chokidar.watch(this.root, { ignoreInitial: true, followSymlinks: false, ignored: file => /(?:^|[\\/])(?:\.stversions|\.stfolder|\.syncit-tmp-[^\\/]*|\.syncthing[^\\/]*|~syncthing~[^\\/]*)/.test(file), awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 } });
    this.watcher.on('all', (event, file) => { this.track(event, file); clearTimeout(this.timer); this.timer = setTimeout(this.changed, 120); });
    this.watcher.on('error', () => { this.index = undefined; this.changed(); });
    this.rescanTimer = setInterval(() => { this.index = undefined; }, RESCAN_INTERVAL_MS);
    this.rescanTimer.unref?.();
    void this.pruneRecovery().catch(() => {});
  }
  async close() { clearTimeout(this.timer); clearInterval(this.rescanTimer); await this.watcher?.close(); await this.chain; await this.indexChain; }
  private track(event: string, file: string) {
    const relative = path.relative(this.root, file).split(path.sep).join('/');
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || isInternal(relative)) return;
    this.indexChain = this.indexChain.then(async () => {
      if (!this.index) return;
      if (event === 'unlink') this.index.delete(relative);
      else if (event === 'unlinkDir') { for (const key of [...this.index.keys()]) if (key === relative || key.startsWith(relative + '/')) this.index.delete(key); }
      else if (event === 'add' || event === 'change') await this.refreshEntry(relative);
      else if (event === 'addDir') for (const [key, item] of await this.walk(path.join(this.root, relative))) this.index.set(key, item);
    }).catch(() => { this.index = undefined; });
  }
  private async refreshEntry(relative: string) {
    if (!this.index) return;
    const item = await this.describe(relative);
    if (item) this.index.set(relative, item); else this.index.delete(relative);
  }
  private async describe(relative: string): Promise<LibraryItem | null> {
    try {
      const full = await contained(this.root, relative);
      const stat = await fs.lstat(full);
      if (!stat.isFile()) return null;
      const name = path.basename(relative); const ext = path.extname(name).toLowerCase();
      const kind = ['.md', '.txt'].includes(ext) && stat.size <= NOTE_LIMIT ? 'note' : mediaKind(name) || 'file';
      const preview = kind === 'note' ? (await fs.readFile(full, 'utf8')).slice(0, 32_000) : undefined;
      return { path: relative, name, kind, size: stat.size, modifiedAt: stat.mtimeMs, preview, conflict: name.includes('.sync-conflict-') };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' || /outside|unsafe|Linked/.test((error as Error).message)) return null; throw error; }
  }
  private async walk(dir: string): Promise<Map<string, LibraryItem>> {
    const found = new Map<string, LibraryItem>();
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(this.root, full).split(path.sep).join('/');
      if (isInternal(relative) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { for (const [key, item] of await this.walk(full)) found.set(key, item); continue; }
      if (!entry.isFile()) continue;
      const item = await this.describe(relative);
      if (item) found.set(relative, item);
    }
    return found;
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.chain.then(operation);
    this.chain = run.catch(() => {});
    return run;
  }
  async snapshot(): Promise<LibrarySnapshot> {
    let items: LibraryItem[] = [];
    const placements: BoardPlacement[] = [];
    try {
      if (!(await fs.lstat(this.root)).isDirectory()) throw new Error('Collection folder is unavailable');
      await this.indexChain;
      if (!this.index) this.index = await this.walk(this.root);
      items = [...this.index.values()];
      const board = await contained(this.root, '.syncit/board', true);
      for (const name of await fs.readdir(board)) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
        try {
          const file = await contained(this.root, `.syncit/board/${name}`, true);
          if ((await fs.stat(file)).size > 8192) continue;
          const record = validatePlacement(JSON.parse(await fs.readFile(file, 'utf8')));
          if (hash(record.path) + '.json' === name && items.some(item => item.path === record.path)) placements.push(record);
        } catch { /* Incomplete or invalid remote metadata must never break the library. */ }
      }
      return { items: items.sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path)), placements };
    } catch (error) { this.index = undefined; return { items: [], placements, error: errorMessage(error) }; }
  }
  private async availableName(dir: string, desired: string) {
    const ext = path.extname(desired); const stem = path.basename(desired, ext);
    let name = cleanName(desired);
    while (true) {
      try { await fs.access(path.join(dir, name)); name = `${cleanName(stem)}-${randomUUID().slice(0, 8)}${ext}`; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return name; throw error; }
    }
  }
  async importFiles(sources: string[]): Promise<void> {
    return this.serial(async () => {
      for (const source of sources) {
        const fullSource = path.resolve(source);
        const relative = path.relative(this.root, fullSource);
        if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) continue;
        const rootWithinSource = path.relative(fullSource, this.root);
        if (!rootWithinSource.startsWith('..' + path.sep) && rootWithinSource !== '..' && !path.isAbsolute(rootWithinSource)) throw new Error('Cannot import a folder that contains the collection');
        const copy = async (from: string, into: string) => {
          const stat = await fs.lstat(from);
          if (stat.isSymbolicLink()) throw new Error('Linked files and folders cannot be imported');
          const name = await this.availableName(into, path.basename(from));
          const target = await contained(this.root, path.relative(this.root, path.join(into, name)));
          if (stat.isDirectory()) {
            await fs.mkdir(target);
            for (const entry of await fs.readdir(from)) {
              if (!isInternal(entry)) await copy(path.join(from, entry), target);
            }
          } else if (stat.isFile()) {
            const temporary = path.join(into, `.syncit-tmp-${randomUUID()}`);
            try { await fs.copyFile(from, temporary, constants.COPYFILE_EXCL); await linkOrClaim(temporary, target); }
            finally { await fs.unlink(temporary).catch(() => {}); }
          } else throw new Error('Only regular files and folders can be imported');
        };
        await copy(fullSource, this.root);
      }
      this.index = undefined; // Imports can add whole trees; rebuild on the next snapshot.
      this.changed();
    });
  }
  async createNote(text = ''): Promise<NoteDocument> {
    return this.serial(async () => {
      this.validateText(text);
      const title = cleanName(text.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').slice(0, 60) || 'Untitled note');
      const name = await this.availableName(this.root, `${title}.md`);
      await atomicWrite(await contained(this.root, name), text, false);
      await this.refreshEntry(name); this.changed();
      return { path: name, text, revision: hash(text) };
    });
  }
  async addImage(bytes: Buffer): Promise<string> {
    if (bytes.length > 100 * 1024 * 1024) throw new Error('Clipboard image is too large (maximum 100 MB)');
    return this.addBytes(`Screenshot ${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.png`, bytes);
  }
  /** Add a file from memory (clipboard images, phone uploads) under a cleaned, non-colliding name at the collection root. */
  async addBytes(desired: unknown, bytes: Buffer): Promise<string> {
    return this.serial(async () => {
      if (!Buffer.isBuffer(bytes) || bytes.length > 100 * 1024 * 1024) throw new Error('Files added this way must be smaller than 100 MB');
      if (typeof desired !== 'string' || !desired.trim() || desired.length > 255) throw new Error('A file name is required');
      const name = await this.availableName(this.root, path.basename(desired.replaceAll('\\', '/')));
      await atomicWrite(await contained(this.root, name), bytes, false);
      await this.refreshEntry(name); this.changed(); return name;
    });
  }
  async readNote(relative: string): Promise<NoteDocument> {
    const target = await contained(this.root, relative);
    if (!['.md', '.txt'].includes(path.extname(target).toLowerCase())) throw new Error('This file is not a note');
    if ((await fs.stat(target)).size > NOTE_LIMIT) throw new Error('Open notes larger than 1 MB in your text editor');
    const text = await fs.readFile(target, 'utf8');
    return { path: relative, text, revision: hash(text) };
  }
  async saveNote(relative: string, text: string, revision: string): Promise<NoteDocument> {
    return this.serial(async () => {
      this.validateText(text);
      const target = await contained(this.root, relative);
      if (!['.md', '.txt'].includes(path.extname(target).toLowerCase())) throw new Error('This file is not a note');
      let current: string | null = null;
      let previous: NoteDocument | undefined;
      try { previous = await this.readNote(relative); current = previous.revision; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (previous && previous.text !== text && this.recoveryDirectory) {
        await fs.mkdir(this.recoveryDirectory, { recursive: true, mode: 0o700 });
        const stem = cleanName(path.basename(relative, path.extname(relative)));
        await atomicWrite(path.join(this.recoveryDirectory, `${stem}-${Date.now()}-${randomUUID().slice(0, 6)}.md`), previous.text, false);
        await this.pruneRecovery(stem).catch(() => {}); // Retention is best-effort and never blocks a save.
      }
      let savedPath = relative;
      if (current !== revision) {
        const ext = path.extname(target);
        savedPath = path.posix.join(path.posix.dirname(relative), `${path.basename(target, ext)}.sync-conflict-${Date.now()}-${randomUUID().slice(0, 6)}${ext}`);
      }
      await atomicWrite(await contained(this.root, savedPath), text, savedPath === relative);
      await this.refreshEntry(savedPath); this.changed();
      return { path: savedPath, text, revision: hash(text), conflict: current !== revision };
    });
  }
  private async renameHistory(from: string, to: string) {
    if (!this.recoveryDirectory) return;
    const oldStem = cleanName(path.basename(from, path.extname(from))); const newStem = cleanName(path.basename(to, path.extname(to)));
    if (oldStem === newStem) return;
    const pattern = new RegExp(`^${escapeRegExp(oldStem)}-(\\d{13}-[a-f0-9]{6})\\.md$`);
    for (const name of await fs.readdir(this.recoveryDirectory).catch(() => [] as string[])) {
      const match = pattern.exec(name); if (!match) continue;
      await fs.rename(path.join(this.recoveryDirectory, name), path.join(this.recoveryDirectory, `${newStem}-${match[1]}.md`)).catch(() => {});
    }
  }
  /** Previous versions of a note: local pre-save copies plus versions Syncthing archived under .stversions. Newest first. */
  async history(relative: string): Promise<NoteVersion[]> {
    await contained(this.root, relative);
    const ext = path.extname(relative); const base = path.basename(relative, ext); const dir = path.posix.dirname(relative);
    const versions: NoteVersion[] = [];
    if (this.recoveryDirectory) {
      const pattern = new RegExp(`^${escapeRegExp(cleanName(base))}-(\\d{13})-[a-f0-9]{6}\\.md$`);
      for (const name of await fs.readdir(this.recoveryDirectory).catch(() => [] as string[])) {
        const match = pattern.exec(name); if (!match) continue;
        const stat = await fs.stat(path.join(this.recoveryDirectory, name)).catch(() => null);
        if (stat?.isFile()) versions.push({ id: `local:${name}`, source: 'local', time: Number(match[1]), size: stat.size });
      }
    }
    const archive = await contained(this.root, path.posix.join('.stversions', dir === '.' ? '' : dir), true);
    const received = new RegExp(`^${escapeRegExp(base)}~(\\d{4})(\\d{2})(\\d{2})-(\\d{2})(\\d{2})(\\d{2})${escapeRegExp(ext)}$`);
    for (const name of await fs.readdir(archive).catch(() => [] as string[])) {
      const match = received.exec(name); if (!match) continue;
      const stat = await fs.stat(path.join(archive, name)).catch(() => null);
      const [, y, mo, d, h, mi, s] = match.map(Number);
      if (stat?.isFile()) versions.push({ id: `received:${path.posix.join(dir === '.' ? '' : dir, name)}`, source: 'received', time: new Date(y, mo - 1, d, h, mi, s).getTime(), size: stat.size });
    }
    return versions.sort((a, b) => b.time - a.time).slice(0, 50);
  }
  async readVersion(id: unknown): Promise<string> {
    if (typeof id !== 'string' || id.length > 4200) throw new Error('Invalid note version');
    let file: string;
    if (id.startsWith('local:')) {
      const name = id.slice(6);
      if (!this.recoveryDirectory || !recoveryPattern.test(name) || /[\\/]/.test(name)) throw new Error('Invalid note version');
      file = path.join(this.recoveryDirectory, name);
    } else if (id.startsWith('received:')) {
      const relative = id.slice(9);
      if (!/~\d{8}-\d{6}/.test(relative) || relative.includes('\0')) throw new Error('Invalid note version');
      file = await contained(this.root, path.posix.join('.stversions', relative), true);
    } else throw new Error('Invalid note version');
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > NOTE_LIMIT) throw new Error('This version is not a note smaller than 1 MB');
    return fs.readFile(file, 'utf8');
  }
  /** Keep the newest RECOVERY_KEEP_PER_NOTE previous versions per note and drop versions older than RECOVERY_MAX_AGE_MS. */
  async pruneRecovery(stem?: string) {
    if (!this.recoveryDirectory) return;
    const names = await fs.readdir(this.recoveryDirectory).catch(() => [] as string[]);
    const byStem = new Map<string, { name: string; time: number }[]>();
    for (const name of names) {
      const match = recoveryPattern.exec(name);
      if (!match || (stem !== undefined && match[1] !== stem)) continue;
      const list = byStem.get(match[1]) || []; list.push({ name, time: Number(match[2]) }); byStem.set(match[1], list);
    }
    const cutoff = Date.now() - RECOVERY_MAX_AGE_MS;
    for (const list of byStem.values()) {
      list.sort((a, b) => b.time - a.time);
      for (const [index, entry] of list.entries()) if (index >= RECOVERY_KEEP_PER_NOTE || entry.time < cutoff) await fs.unlink(path.join(this.recoveryDirectory, entry.name)).catch(() => {});
    }
  }
  private validateText(text: unknown): asserts text is string {
    if (typeof text !== 'string' || Buffer.byteLength(text) > NOTE_LIMIT) throw new Error('Notes must be text smaller than 1 MB');
  }
  async place(value: BoardPlacement) {
    return this.serial(async () => {
      const record = validatePlacement(value);
      await fs.access(await contained(this.root, record.path));
      await atomicWrite(await contained(this.root, `.syncit/board/${hash(record.path)}.json`, true), JSON.stringify({ ...record, updatedAt: Date.now() }));
      this.changed();
    });
  }
  async unpin(relative: string) {
    safeRelative(relative);
    return this.serial(async () => { await fs.unlink(await contained(this.root, `.syncit/board/${hash(relative)}.json`, true)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); this.changed(); });
  }
  async rename(relative: string, name: string): Promise<string> {
    return this.serial(async () => {
      if (typeof name !== 'string' || name !== cleanName(name) || !name.trim()) throw new Error('Choose a valid filename without slashes or reserved characters');
      const original = await contained(this.root, relative);
      const next = path.posix.join(path.posix.dirname(relative), name);
      if (next === relative) return relative;
      const target = await contained(this.root, next);
      try { await fs.lstat(target); throw new Error('A file with that name already exists'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await fs.rename(original, target);
      this.index?.delete(relative); await this.refreshEntry(next);
      await this.renameHistory(relative, next).catch(() => {}); // History follows the note; losing a copy never fails a rename.
      const oldPlacement = await contained(this.root, `.syncit/board/${hash(relative)}.json`, true);
      try {
        const record = validatePlacement(JSON.parse(await fs.readFile(oldPlacement, 'utf8')));
        await atomicWrite(await contained(this.root, `.syncit/board/${hash(next)}.json`, true), JSON.stringify({ ...record, path: next, updatedAt: Date.now() }));
        await fs.unlink(oldPlacement);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      this.changed(); return next;
    });
  }
  /** Moves an item into a folder of the collection ('' for the top level), creating the folder when needed. */
  async move(relative: string, folder: string): Promise<string> {
    return this.serial(async () => {
      if (typeof folder !== 'string') throw new Error('Invalid folder');
      const parts = folder.split(/[\\/]/).filter(Boolean);
      if (parts.some(part => part !== cleanName(part) || part.startsWith('.') || !part.trim()) || parts.length > 8) throw new Error('Choose a folder name without slashes, leading dots or reserved characters');
      const original = await contained(this.root, relative);
      const name = path.posix.basename(relative);
      const next = [...parts, name].join('/');
      if (next === relative) return relative;
      const target = await contained(this.root, next);
      await fs.mkdir(path.dirname(target), { recursive: true });
      try { await fs.lstat(target); throw new Error(`“${name}” already exists in that folder`); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await fs.rename(original, target);
      this.index?.delete(relative); await this.refreshEntry(next);
      await this.renameHistory(relative, next).catch(() => {});
      const oldPlacement = await contained(this.root, `.syncit/board/${hash(relative)}.json`, true);
      try {
        const record = validatePlacement(JSON.parse(await fs.readFile(oldPlacement, 'utf8')));
        await atomicWrite(await contained(this.root, `.syncit/board/${hash(next)}.json`, true), JSON.stringify({ ...record, path: next, updatedAt: Date.now() }));
        await fs.unlink(oldPlacement);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      this.changed(); return next;
    });
  }
  async trash(relative: string) {
    await this.serial(async () => { await this.recycle(await contained(this.root, relative)); this.index?.delete(relative); this.changed(); });
    await this.unpin(relative);
  }
}
export function validatePlacement(value: unknown): BoardPlacement {
  const record = value as BoardPlacement;
  if (!record || record.version !== 1) throw new Error('Unsupported pinboard record');
  safeRelative(record.path);
  for (const field of ['x', 'y', 'width', 'height', 'updatedAt'] as const) if (typeof record[field] !== 'number' || !Number.isFinite(record[field])) throw new Error('Invalid card position');
  if (record.x < 0 || record.y < 0 || record.x > 20000 || record.y > 20000 || record.width < 180 || record.width > 1200 || record.height < 140 || record.height > 1200) throw new Error('Card is outside the supported board area');
  return { version: 1, path: record.path, x: record.x, y: record.y, width: record.width, height: record.height, updatedAt: record.updatedAt };
}
