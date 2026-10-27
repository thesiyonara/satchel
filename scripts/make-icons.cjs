// Renders the Satchel mark into every icon the app ships: the app icon (PNG and ICO), the tray icons and the
// phone page icon. Run with `npx electron scripts/make-icons.cjs`. The mark is a solid block with a strap across it.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const coral = '#e0491e', ink = '#17191c', paper = '#f5f5f2';

// Draws one icon on a canvas inside a hidden window and returns its PNG bytes.
const page = `<!doctype html><canvas id="c"></canvas><script>
function rounded(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function strap(ctx, x, y, size, width) { const c = x + size / 2 + y + size / 2; ctx.beginPath(); ctx.moveTo(c - width / 2 - y, y); ctx.lineTo(c + width / 2 - y, y); ctx.lineTo(x, c + width / 2 - x); ctx.lineTo(x, c - width / 2 - x); ctx.closePath(); }
function render(size, kind) {
  const canvas = document.getElementById('c'); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, size, size);
  const mono = kind === 'template' || kind === 'white';
  const block = mono ? size * 0.78 : size * (size <= 32 ? 0.6 : 0.54);
  const offset = (size - block) / 2;
  const band = block * (size <= 32 ? 0.3 : 0.24);
  if (!mono) { ctx.fillStyle = '${coral}'; rounded(ctx, 0, 0, size, size, size * 0.225); ctx.fill(); }
  ctx.fillStyle = kind === 'white' ? '#ffffff' : '${ink}';
  rounded(ctx, offset, offset, block, block, block * 0.31); ctx.fill();
  ctx.save(); rounded(ctx, offset, offset, block, block, block * 0.31); ctx.clip();
  if (mono) ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = mono ? '#000' : '${paper}';
  strap(ctx, offset, offset, block, band); ctx.fill();
  ctx.restore();
  return canvas.toDataURL('image/png');
}
</script>`;

// Packs PNG images into one ICO file; Windows reads PNG-compressed entries since Vista.
function ico(images) {
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  const entries = []; let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); entry.writeUInt8(size >= 256 ? 0 : size, 1); entry.writeUInt8(0, 2); entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(offset, 12);
    entries.push(entry); offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map(image => image.png)]);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
  const png = async (size, kind = 'app') => Buffer.from((await window.webContents.executeJavaScript(`render(${size}, ${JSON.stringify(kind)})`)).split(',')[1], 'base64');
  await fs.writeFile(path.join(root, 'assets/icon.png'), await png(512));
  await fs.writeFile(path.join(root, 'web/icon.png'), await png(512));
  await fs.writeFile(path.join(root, 'assets/tray.png'), await png(32));
  await fs.writeFile(path.join(root, 'assets/trayTemplate.png'), await png(32, 'template'));
  await fs.writeFile(path.join(root, 'assets/trayTemplate@2x.png'), await png(64, 'template'));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  await fs.writeFile(path.join(root, 'assets/icon.ico'), ico(await Promise.all(sizes.map(async size => ({ size, png: await png(size) })))));
  console.log('icons written: assets/icon.png, assets/icon.ico, assets/tray.png, assets/trayTemplate.png, assets/trayTemplate@2x.png, web/icon.png');
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
