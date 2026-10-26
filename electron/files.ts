import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function isInternal(relative: string): boolean {
  return relative.split(/[\\/]/).some(part => /^\.(syncit|stfolder|stignore|stversions|syncthing)(?:$|[.-])|^~syncthing~|^\.DS_Store$|^Thumbs\.db$/i.test(part));
}
export function safeRelative(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0')) throw new Error('Invalid file path');
  const relative = value.replaceAll('\\', '/');
  if (path.posix.isAbsolute(relative) || path.win32.isAbsolute(value) || /[<>:"|?*\x00-\x1f]/.test(relative) || relative.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)) || isInternal(relative)) throw new Error('This path is outside the collection or uses an unsafe filename');
  return relative;
}
export async function contained(root: string, relative: string, internal = false): Promise<string> {
  if (!internal) relative = safeRelative(relative);
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  const rel = path.relative(base, target);
  if (!rel || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) throw new Error('This path is outside the collection');
  const rootStat = await fs.lstat(base);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Collection must be a local folder, not a link');
  let current = base;
  for (const segment of rel.split(path.sep)) {
    current = path.join(current, segment);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Linked files and folders are not supported'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error; }
  }
  return target;
}
export function cleanName(value: string): string {
  let result = value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim().slice(0, 160).replace(/[. ]+$/g, '').trim();
  if (!result || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(result) || isInternal(result)) result = `Item-${randomUUID().slice(0, 8)}`;
  return result;
}
export async function atomicWrite(target: string, contents: string | Buffer, replace = true): Promise<void> {
  const temporary = path.join(path.dirname(target), `.syncit-tmp-${randomUUID()}`);
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
    if (replace) await fs.rename(temporary, target);
    else await linkOrClaim(temporary, target);
  } finally { await fs.unlink(temporary).catch(() => {}); }
}
// Create-if-absent without an overwrite race. A hard link does that atomically; volumes without hard
// links (exFAT, FAT32, some network shares) fall back to claiming the name exclusively, then moving over the claim.
export async function linkOrClaim(temporary: string, target: string): Promise<void> {
  try { await fs.link(temporary, target); return; }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code || '';
    // libuv reports Windows ERROR_INVALID_FUNCTION (hard links on exFAT/FAT32) as EISDIR.
    if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EINVAL', 'EISDIR'].includes(code)) throw error;
  }
  const claim = await fs.open(target, 'wx', 0o600); await claim.close();
  await fs.rename(temporary, target);
}
export async function readJSON<T>(file: string): Promise<T> { return JSON.parse(await fs.readFile(file, 'utf8')) as T; }
export function errorMessage(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOSPC') return 'This disk is full. Free some space and try again. Your changes have not been discarded.';
  if (code === 'ENOENT') return 'The file or collection folder is unavailable. Restore it to its original location and try again.';
  if (code === 'EACCES' || code === 'EPERM') return 'Access was denied. Check folder permissions or close the file in the other app.';
  return error instanceof Error ? error.message : String(error);
}
