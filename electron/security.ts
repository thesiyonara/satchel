import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

// Launch only formats intended for viewers. Scripts, installers, shortcuts and
// active web documents can still be revealed in Explorer/Finder, never run here.
// OpenDocument files (.odt/.ods/.odp) can embed LibreOffice macros, so they are treated like .docm/.xlsm.
const viewable = new Set(['.txt', '.md', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.heic', '.tif', '.tiff', '.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.ogv', '.3gp', '.csv', '.docx', '.xlsx', '.pptx', '.rtf', '.zip', '.7z']);
export function assertSafeToOpen(file: string) {
  if (!viewable.has(path.extname(file).toLowerCase())) throw new Error('This file type is not launched from Sync it. Use “Show in folder” and inspect it before opening.');
}
export function rendererRequestAllowed(url: string, devURL?: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'syncit-app:' && parsed.hostname === 'app') return true;
    if (parsed.protocol === 'syncit-media:' && (parsed.hostname === 'image' || parsed.hostname === 'media')) return true;
    if (devURL && ['http:', 'ws:'].includes(parsed.protocol) && parsed.host === new URL(devURL).host) return true;
    return false;
  } catch { return false; }
}
export async function secureDirectory(directory: string) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Private application storage must be a real local directory');
  if (process.platform === 'win32') {
    // Absolute System32 paths: PATH order (or a planted whoami.exe) must never decide which tool runs.
    const system32 = (tool: string) => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', tool);
    const { stdout } = await execute(system32('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { windowsHide: true });
    const sid = stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];
    if (!sid) throw new Error('Cannot identify the current Windows account to protect private application data');
    await execute(system32('icacls.exe'), [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true });
  } else await fs.chmod(directory, 0o700);
}
export const appCSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src syncit-media: data:; media-src syncit-media:; frame-src syncit-media:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
