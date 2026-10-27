// What the app can show inside itself, by file extension. Shared by the main process, the renderer and
// the phone service so every surface agrees. "Browser" images render natively in Chromium and Safari;
// the rest (HEIC from iPhones, TIFF, RAW-like formats) get a preview rendered by the operating system.
export const browserImageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg', '.ico'];
export const osImageExtensions = ['.heic', '.heif', '.tif', '.tiff', '.jxl', '.psd', '.dng', '.cr2', '.nef', '.arw', '.raf'];
export const imageExtensions = [...browserImageExtensions, ...osImageExtensions];
export const videoExtensions = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.ogv', '.3gp', '.mts', '.m2ts', '.wmv'];
export const audioExtensions = ['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.oga', '.opus', '.aiff', '.wma'];
export const documentExtensions = ['.pdf'];
export const textExtensions = ['.txt', '.md', '.csv', '.tsv', '.json', '.xml', '.yaml', '.yml', '.log', '.ini', '.cfg', '.conf', '.toml', '.env', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.cs', '.php', '.sh', '.ps1', '.bat', '.cmd', '.sql', '.html', '.htm', '.css', '.scss', '.srt', '.vtt'];
export const mediaTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.ogv': 'video/ogg', '.3gp': 'video/3gpp', '.mts': 'video/mp2t', '.m2ts': 'video/mp2t', '.wmv': 'video/x-ms-wmv',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.aiff': 'audio/aiff', '.wma': 'audio/x-ms-wma',
  '.pdf': 'application/pdf'
};
export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text';
const extensionOf = (file: string) => { const index = file.lastIndexOf('.'); return index < 0 ? '' : file.slice(index).toLowerCase(); };
/** The collection kind an item is listed under. Text-like files other than notes stay "file" but still preview as text. */
export function mediaKind(file: string): 'image' | 'video' | 'audio' | null {
  const ext = extensionOf(file);
  return imageExtensions.includes(ext) ? 'image' : videoExtensions.includes(ext) ? 'video' : audioExtensions.includes(ext) ? 'audio' : null;
}
/** How the app shows the file inside itself, or null when it only opens in its default app (office documents, archives, executables). */
export function previewKind(file: string): PreviewKind | null {
  const ext = extensionOf(file);
  if (imageExtensions.includes(ext)) return 'image';
  if (videoExtensions.includes(ext)) return 'video';
  if (audioExtensions.includes(ext)) return 'audio';
  if (documentExtensions.includes(ext)) return 'pdf';
  if (textExtensions.includes(ext)) return 'text';
  return null;
}
/** True when the browser engine can decode the image itself; otherwise the OS-rendered preview is used. */
export function browserRenders(file: string) { return browserImageExtensions.includes(extensionOf(file)); }
/** Files the stream route serves as-is: images, video, audio and PDF. Text is served through a size-limited text route instead. */
export function streamable(file: string) { const kind = previewKind(file); return kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf'; }
export function mediaType(file: string) { return mediaTypes[extensionOf(file)] || 'application/octet-stream'; }
