// HTTP range streaming for the desktop protocol handler and the phone service. Kinds live in shared/media.ts.
import { promises as fs, createReadStream, type ReadStream } from 'node:fs';
import { mediaType, textExtensions } from '../shared/media';
import path from 'node:path';
export { mediaKind, previewKind, streamable, browserRenders, mediaType } from '../shared/media';

export const TEXT_PREVIEW_LIMIT = 1024 * 1024;
export interface RangeResponse { status: number; headers: Record<string, string>; stream: ReadStream | null }
/** Open `target` for HTTP delivery honouring a single `bytes=` range, which <video> and <audio> need for seeking. */
export async function openRange(target: string, rangeHeader: string | null | undefined): Promise<RangeResponse> {
  const stat = await fs.lstat(target);
  if (!stat.isFile()) throw new Error('Not a file');
  const base = { 'Content-Type': mediaType(target), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
  if (!match || stat.size === 0) return { status: 200, headers: { ...base, 'Content-Length': String(stat.size) }, stream: stat.size ? createReadStream(target) : null };
  const start = match[1] === '' ? Math.max(0, stat.size - Number(match[2])) : Number(match[1]);
  const end = match[2] === '' || match[1] === '' ? stat.size - 1 : Math.min(Number(match[2]), stat.size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) return { status: 416, headers: { ...base, 'Content-Range': `bytes */${stat.size}` }, stream: null };
  return { status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) }, stream: createReadStream(target, { start, end }) };
}
/** Read a text-like file for a read-only preview. Refuses other extensions and anything over 1 MB. */
export async function readTextPreview(target: string): Promise<string> {
  if (!textExtensions.includes(path.extname(target).toLowerCase())) throw new Error('This file is not previewable as text');
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.size > TEXT_PREVIEW_LIMIT) throw new Error('Text previews cover files up to 1 MB');
  return fs.readFile(target, 'utf8');
}
