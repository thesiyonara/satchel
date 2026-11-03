// Renders the Satchel mark into every icon the app ships: the app icon (PNG and ICO), the tray icons and the
// phone page icon and the website icon. Run with `npx electron scripts/make-icons.cjs`.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const coral = '#e0491e', ink = '#17191c', paper = '#f5f5f2';

// Draws one icon on a canvas inside a hidden window and returns its PNG bytes. The mark is the one src/Mark.tsx draws, in a 48-unit box.
const page = `<!doctype html><canvas id="c"></canvas><script>
function rounded(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function mark(ctx, scale, offset, ink, gap, buckle, cut) {
  ctx.save(); ctx.translate(offset, offset); ctx.scale(scale, scale);
  ctx.strokeStyle = ink; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(18, 14); ctx.bezierCurveTo(18, 6.5, 30, 6.5, 30, 14); ctx.stroke();
  ctx.fillStyle = ink; rounded(ctx, 4, 12, 40, 31, 9); ctx.fill();
  rounded(ctx, 4, 12, 40, 31, 9); ctx.clip();
  if (cut) ctx.globalCompositeOperation = 'destination-out';
  ctx.strokeStyle = gap; ctx.lineWidth = 2.6; ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(4, 20); ctx.bezierCurveTo(4, 27, 8.5, 30.5, 14, 30.5); ctx.lineTo(34, 30.5); ctx.bezierCurveTo(39.5, 30.5, 44, 27, 44, 20); ctx.stroke();
  ctx.fillStyle = buckle; rounded(ctx, 21.3, 27, 5.4, 9, 2.2); ctx.fill();
  ctx.restore();
}
function render(size, kind) {
  const canvas = document.getElementById('c'); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, size, size);
  if (kind === 'template') { const box = size * 0.96; mark(ctx, box / 48, (size - box) / 2, '#000', '#000', '#000', true); return canvas.toDataURL('image/png'); }
  ctx.fillStyle = '${coral}'; rounded(ctx, 0, 0, size, size, size * 0.225); ctx.fill();
  const box = size * (size <= 32 ? 0.84 : 0.74);
  mark(ctx, box / 48, (size - box) / 2, '${ink}', '${coral}', '${paper}', false);
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
  await fs.writeFile(path.join(root, 'web/icon.png'), await png(512)); await fs.writeFile(path.join(root, 'site/img/icon.png'), await png(512));
  await fs.writeFile(path.join(root, 'assets/tray.png'), await png(32));
  await fs.writeFile(path.join(root, 'assets/trayTemplate.png'), await png(32, 'template'));
  await fs.writeFile(path.join(root, 'assets/trayTemplate@2x.png'), await png(64, 'template'));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  await fs.writeFile(path.join(root, 'assets/icon.ico'), ico(await Promise.all(sizes.map(async size => ({ size, png: await png(size) })))));
  console.log('icons written: assets/icon.png, assets/icon.ico, assets/tray.png, assets/trayTemplate.png, assets/trayTemplate@2x.png, web/icon.png, site/img/icon.png');
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
