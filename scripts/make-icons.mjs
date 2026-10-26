import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
function crc32(buffer) { let crc = -1; for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ -1) >>> 0; }
function chunk(type, bytes) { const name = Buffer.from(type); const result = Buffer.alloc(bytes.length + 12); result.writeUInt32BE(bytes.length); name.copy(result, 4); bytes.copy(result, 8); result.writeUInt32BE(crc32(Buffer.concat([name, bytes])), result.length - 4); return result; }
function rounded(x, y, cx, cy, w, h, radius) { const dx = Math.max(Math.abs(x - cx) - (w / 2 - radius), 0); const dy = Math.max(Math.abs(y - cy) - (h / 2 - radius), 0); return dx * dx + dy * dy <= radius * radius && Math.abs(x - cx) <= w / 2 && Math.abs(y - cy) <= h / 2; }
function png(size, tray = false, black = false) {
  const bytes = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sum = [0, 0, 0, 0];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
      const px = (x + (a + .5) / 4) / size * 256; const py = (y + (b + .5) / 4) / size * 256;
      const bg = !tray && rounded(px, py, 128, 128, 252, 252, 58);
      const rx = (px - 128) * .7071 + (py - 128) * .7071 + 128;
      const ry = (py - 128) * .7071 - (px - 128) * .7071 + 128;
      const link = [99, 157].some(cx => rounded(rx, ry, cx, 128, 104, 65, 29) && !rounded(rx, ry, cx, 128, 76, 37, 16));
      const color = link ? (tray ? (black ? [0, 0, 0, 255] : [255, 121, 82, 255]) : [25, 16, 13, 255]) : bg ? [255, 121, 82, 255] : [0, 0, 0, 0];
      for (let c = 0; c < 4; c++) sum[c] += color[c] / 16;
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    for (let c = 0; c < 4; c++) bytes[offset + c] = Math.round(sum[c]);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(bytes)), chunk('IEND', Buffer.alloc(0))]);
}
await mkdir('assets', { recursive: true });
await writeFile('assets/icon.png', png(512));
await writeFile('assets/tray.png', png(32, true));
await writeFile('assets/trayTemplate.png', png(32, true, true));
const icon = png(256); const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(icon.length, 14); header.writeUInt32LE(22, 18);
await writeFile('assets/icon.ico', Buffer.concat([header, icon]));
