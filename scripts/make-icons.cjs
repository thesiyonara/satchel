// Renders the Satchel mark into every icon the app ships: the app icon (PNG and ICO), the tray icons and the
// phone page icon and the website icon. Run with `npx electron scripts/make-icons.cjs`.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
// Rasterize the same folded S used by the desktop title bar and website.
const page = `<!doctype html><canvas></canvas><script>
async function render(size, kind, source) {
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.querySelector('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const template = kind === 'template';
  const box = template ? size * 0.875 : size * 0.72;
  const offset = (size - box) / 2;
  ctx.drawImage(image, offset, offset, box, box);
  if (!template) {
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#f6f3e9';
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#263a3c';
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, size * 0.225);
    ctx.fill();
  }
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
  const svg = await fs.readFile(path.join(root, 'site/img/mark.svg'));
  const source = 'data:image/svg+xml;base64,' + svg.toString('base64');
  const png = async (size, kind = 'app') => Buffer.from((await window.webContents.executeJavaScript(
    `render(${size}, ${JSON.stringify(kind)}, ${JSON.stringify(source)})`
  )).split(',')[1], 'base64');
  const appIcon = await png(512);
  for (const file of ['assets/icon.png', 'web/icon.png', 'site/img/icon.png']) await fs.writeFile(path.join(root, file), appIcon);
  await fs.writeFile(path.join(root, 'assets/tray.png'), await png(32));
  // Electron uses the 1x dimensions as logical points and picks the matching Retina representation.
  await fs.writeFile(path.join(root, 'assets/trayTemplate.png'), await png(16, 'template'));
  await fs.writeFile(path.join(root, 'assets/trayTemplate@2x.png'), await png(32, 'template'));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  await fs.writeFile(path.join(root, 'assets/icon.ico'), ico(await Promise.all(sizes.map(async size => ({ size, png: await png(size) })))));
  console.log('icons written: assets/icon.png, assets/icon.ico, assets/tray.png, assets/trayTemplate.png, assets/trayTemplate@2x.png, web/icon.png, site/img/icon.png');
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
