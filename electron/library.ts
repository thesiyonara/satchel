import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import chokidar, { type FSWatcher } from 'chokidar';
import type { BoardPlacement, LibraryItem, LibrarySnapshot, NoteDocument, NoteVersion, Pasteboard, PasteboardClip } from '../shared/types';
import { atomicWrite, cleanName, contained, errorMessage, hash, isInternal, linkOrClaim, safeRelative, isHidden } from './files';
import { tidyName } from '../shared/format';
import { mediaKind } from './media';

const NOTE_LIMIT = 1024 * 1024;
/** Earlier pasteboard texts kept in Recent. */
const CLIP_LIMIT = 50;
/** True when `next` replaces `previous` rather than continuing to edit it: the texts share less than 80% of the shorter one as a common prefix plus suffix, or `next` is empty. Typing, appending and fixing a word keep the text; pasting something else over it, or clearing it, send the old text to Recent. */
export function replaces(previous: string, next: string): boolean {
  const a = previous.trim(), b = next.trim();
  if (!a) return false;
  if (!b) return true;
  let prefix = 0; while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0; while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  return prefix + suffix < 0.8 * Math.min(a.length, b.length);
}
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
      if (isHidden(relative)) return null;
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
      if (isInternal(relative) || isHidden(entry.name) || entry.isSymbolicLink()) continue;
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
      const pasteboard = await this.readPasteboard().catch(() => undefined);
      return { items: items.sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path)), placements, pasteboard };
    } catch (error) { this.index = undefined; return { items: [], placements, error: errorMessage(error) }; }
  }
  /**
   * The shared pasteboard lives in .syncit, so it syncs with the collection but never shows as an item. The latest write from any computer wins;
   * a conflict copy, if Syncthing makes one, stays out of sight there too. `.syncit/pasteboard.from` names the computer that wrote the text, and
   * each earlier text sits in its own small file under `.syncit/pasteboard/`, so two computers never fight over one list.
   */
  async readPasteboard(): Promise<Pasteboard> {
    const file = await contained(this.root, '.syncit/pasteboard.txt', true);
    let text = '', updatedAt = 0, from: string | undefined;
    try {
      const stat = await fs.stat(file);
      text = stat.size > NOTE_LIMIT ? '' : await fs.readFile(file, 'utf8'); updatedAt = Math.round(stat.mtimeMs);
      from = tidyName((await fs.readFile(await contained(this.root, '.syncit/pasteboard.from', true), 'utf8').catch(() => '')).slice(0, 80)) || undefined;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const recent: PasteboardClip[] = [];
    const dir = await contained(this.root, '.syncit/pasteboard', true);
    for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
      if (!/^[a-z0-9-]{1,64}\.json$/.test(name)) continue;
      try {
        const clipFile = path.join(dir, name);
        if ((await fs.stat(clipFile)).size > NOTE_LIMIT) continue;
        const record = JSON.parse(await fs.readFile(clipFile, 'utf8'));
        if (typeof record?.text !== 'string' || !record.text.trim() || typeof record.time !== 'number') continue;
        recent.push({ id: name.slice(0, -5), text: record.text, time: record.time, from: typeof record.from === 'string' && tidyName(record.from) ? tidyName(record.from).slice(0, 80) : undefined });
      } catch { /* An incomplete or invalid clip, likely still syncing, is skipped. */ }
    }
    recent.sort((a, b) => b.time - a.time);
    return { text, updatedAt, from, recent: recent.slice(0, CLIP_LIMIT) };
  }
  async savePasteboard(text: unknown, from?: string): Promise<Pasteboard> {
    return this.serial(async () => {
      this.validateText(text);
      const current = await this.readPasteboard();
      const file = await contained(this.root, '.syncit/pasteboard.txt', true);
      await fs.mkdir(path.dirname(file), { recursive: true });
      if (replaces(current.text, text)) await this.keepClip(current);
      await atomicWrite(file, text);
      await atomicWrite(await contained(this.root, '.syncit/pasteboard.from', true), (from || '').slice(0, 80));
      this.changed();
      return this.readPasteboard();
    });
  }
  /** The text being replaced goes to Recent, unless the same text is already there. The list is capped at CLIP_LIMIT, oldest out. */
  private async keepClip(current: Pasteboard) {
    if (current.recent.some(clip => clip.text === current.text)) return;
    const dir = await contained(this.root, '.syncit/pasteboard', true); await fs.mkdir(dir, { recursive: true });
    const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    await atomicWrite(path.join(dir, `${id}.json`), JSON.stringify({ text: current.text, time: Date.now(), from: current.from }));
    for (const clip of current.recent.slice(CLIP_LIMIT - 1)) await fs.unlink(path.join(dir, `${clip.id}.json`)).catch(() => {});
  }
  async removeClip(id?: unknown): Promise<Pasteboard> {
    return this.serial(async () => {
      const dir = await contained(this.root, '.syncit/pasteboard', true);
      if (id === undefined || id === null) { for (const clip of (await this.readPasteboard()).recent) await fs.unlink(path.join(dir, `${clip.id}.json`)).catch(() => {}); }
      else {
        if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id)) throw new Error('Invalid pasteboard entry');
        await fs.unlink(path.join(dir, `${id}.json`)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      }
      this.changed();
      return this.readPasteboard();
    });
  }
  private async availableName(dir: string, desired: string) {
    const ext = path.extname(desired); const stem = path.basename(desired, ext);
    let name = cleanName(desired);
    while (true) {
      try { await fs.access(path.join(dir, name)); name = `${cleanName(stem)}-${randomUUID().slice(0, 8)}${ext}`; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return name; throw error; }
    }
  }
  async importFiles(sources: string[], into = ''): Promise<void> {
    return this.serial(async () => {
      // Items land at the top of the collection, or inside the folder being browsed when one is named.
      const destination = into ? await contained(this.root, into) : this.root;
      if (into && !(await fs.stat(destination).catch(() => null))?.isDirectory()) throw new Error('That folder is no longer in the collection');
      // Hidden files and folders (dot names) are left behind: dropped directly they are refused, inside a folder they are skipped.
      const visible = sources.filter(source => !isHidden(path.basename(path.resolve(source))));
      if (sources.length && !visible.length) throw new Error('Hidden files and folders are not imported');
      for (const source of visible) {
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
              if (!isInternal(entry) && !isHidden(entry)) await copy(path.join(from, entry), target);
            }
          } else if (stat.isFile()) {
            const temporary = path.join(into, `.syncit-tmp-${randomUUID()}`);
            try { await fs.copyFile(from, temporary, constants.COPYFILE_EXCL); await linkOrClaim(temporary, target); }
            finally { await fs.unlink(temporary).catch(() => {}); }
          } else throw new Error('Only regular files and folders can be imported');
        };
        await copy(fullSource, destination);
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
      await this.refreshEntry(savedPath);
      // An untitled note takes its first line as its name once it has one, so the card and the file say what the note is about.
      if (savedPath === relative && /^Untitled note(-[a-f0-9]{8})?$/i.test(path.basename(relative, path.extname(relative)))) {
        const firstLine = text.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').trim().slice(0, 60);
        const title = firstLine ? cleanName(firstLine) : '';
        if (title && !/^Untitled note/i.test(title)) savedPath = await this.relocate(relative, await this.availableName(path.dirname(await contained(this.root, relative)), `${title}${path.extname(relative)}`));
      }
      this.changed();
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
      return this.relocate(relative, name);
    });
  }
  /** Renames an item in place, taking its history and its pinboard placement along. Runs inside a serial operation. */
  private async relocate(relative: string, name: string): Promise<string> {
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
