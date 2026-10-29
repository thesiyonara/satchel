import { existsSync, renameSync, rmSync } from 'node:fs';
import { app, BrowserWindow, Menu, Notification, Tray, ipcMain, protocol, nativeImage, clipboard, dialog, shell, globalShortcut, nativeTheme, powerMonitor, screen, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { imageSize } from 'image-size';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Library } from './library';
import { SyncEngine } from './sync-engine';
import { SettingsStore, validateSettingsPatch } from './settings';
import { contained, errorMessage, hash, atomicWrite } from './files';
import type { BoardPlacement, Settings, SyncStatus } from '../shared/types';
import { formatSize } from '../shared/format';
import { appCSP, assertSafeToOpen, rendererRequestAllowed, secureDirectory } from './security';
import { startControl, type ControlHandlers } from './control';
import { Updates } from './updates';
import { Companion } from './companion';
import { localNetworks } from './sync-engine';
import { releasesURL } from '../shared/project';
import { mediaKind, openRange, previewKind, readTextPreview, streamable } from './media';
import { Readable } from 'node:stream';
let companion: Companion;
let updater: Updates;
let preparingUpdate = false;
let updateTimer: ReturnType<typeof setInterval>;
const operations: ControlHandlers = new Map();
let stopControl: (() => Promise<void>) | undefined;
const runId = randomUUID();
app.enableSandbox();
if (app.isPackaged) for (const flag of ['remote-debugging-port', 'remote-debugging-pipe', 'remote-allow-origins', 'no-sandbox', 'disable-web-security', 'ignore-certificate-errors']) app.commandLine.removeSwitch(flag);

const testing = !app.isPackaged && process.env.SYNCIT_TEST_MODE === '1';
const profileOverride = process.argv.find(argument => argument.startsWith('--profile='))?.slice(10);
if (profileOverride) { if (!path.isAbsolute(profileOverride)) throw new Error('--profile must be an absolute directory'); app.setPath('userData', profileOverride); }
if (testing && process.env.SYNCIT_TEST_PROFILE) app.setPath('userData', path.resolve(process.env.SYNCIT_TEST_PROFILE));
// The app was called Sync it before 0.5. A profile still under that name moves to the Satchel folder on start, with its settings, pairings and
// engine database; if the move fails, the old folder keeps being used.
if (!testing && !profileOverride) {
  const current = app.getPath('userData'); const legacy = path.join(path.dirname(current), 'Sync it');
  if (!existsSync(path.join(current, 'settings.json')) && existsSync(path.join(legacy, 'settings.json'))) {
    try { if (existsSync(current)) rmSync(current, { recursive: true, force: true }); renameSync(legacy, current); }
    catch { app.setPath('userData', legacy); }
  }
}
const devURL = !app.isPackaged ? process.env.SYNCIT_DEV_URL : undefined;
const assets = app.isPackaged ? path.join(process.resourcesPath, 'assets') : path.join(app.getAppPath(), 'assets');
const dist = path.join(app.getAppPath(), 'dist');
let mainWindow: BrowserWindow | undefined;
let drawerWindow: BrowserWindow | undefined;
let drawerTimer: ReturnType<typeof setInterval> | undefined;
let drawerOpen = false;
let currentSender: Electron.WebContents | undefined;
let tray: Tray | undefined;
let quitting = false;
let cleanedUp = false;
let library: Library;
let engine: SyncEngine;
let store: SettingsStore;
let scanTimer: ReturnType<typeof setTimeout>;
let registeredShortcut = '';
const windows = () => [mainWindow, drawerWindow, ...handles()].filter((window): window is BrowserWindow => !!window && !window.isDestroyed());
const updateActivity = () => engine?.setActive(windows().some(window => window.isVisible() && !window.isMinimized()));
const broadcast = (channel: string, value?: unknown) => windows().forEach(window => window.webContents.send(channel, value));

protocol.registerSchemesAsPrivileged([
  { scheme: 'syncit-app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'syncit-media', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => showDashboard());
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('Satchel could not start', errorMessage(error)); quitting = true; app.quit(); });
}
// Items annotated with where their latest change came from, when another computer sent it recently.
async function librarySnapshot() {
  const snapshot = await library.snapshot();
  for (const item of snapshot.items) { const arrival = engine?.arrival(item.path); if (arrival) { item.arrivedAt = arrival.at; item.arrivedFrom = arrival.by; } }
  return snapshot;
}
function notifyLibrary() {
  broadcast('syncit:library');
  clearTimeout(scanTimer); scanTimer = setTimeout(() => { void engine?.scan(); }, 250);
}
// The default collection folder was "Sync it" next to the home folder before 0.5. A collection still there moves to "Satchel" beside it before the
// engine and the library open it, and the desktop shortcut made at setup follows. If the folder is in use the move waits for the next start.
async function renameLegacyRoot() {
  const legacy = path.join(os.homedir(), 'Sync it'); const next = path.join(os.homedir(), 'Satchel');
  if (testing || profileOverride || path.resolve(store.value.root) !== legacy || existsSync(next)) return;
  try { await fs.rename(legacy, next); await store.update({ root: next }); } catch { return; }
  const desktop = app.getPath('desktop');
  for (const name of ['Sync it folder', 'Satchel folder']) {
    const link = path.join(desktop, process.platform === 'win32' ? `${name}.lnk` : name);
    if (!existsSync(link)) continue;
    try {
      if (process.platform === 'win32') { if (name === 'Sync it folder') await fs.unlink(link); shell.writeShortcutLink(path.join(desktop, 'Satchel folder.lnk'), { target: next, description: 'Your local Satchel collection' }); }
      else if ((await fs.lstat(link)).isSymbolicLink()) { await fs.unlink(link); await fs.symlink(next, path.join(desktop, 'Satchel folder'), 'dir'); }
    } catch { /* the folder moved; a shortcut that could not follow is recreated from Preferences */ }
  }
}
async function start() {
  await secureDirectory(app.getPath('userData'));
  store = new SettingsStore(app.getPath('userData'), testing || profileOverride ? path.join(app.getPath('userData'), 'collection') : undefined);
  await store.load(); nativeTheme.themeSource = store.value.theme;
  await renameLegacyRoot();
  updater = new Updates(app.getPath('userData'), app.getVersion(), state => broadcast('syncit:update', state));
  await updater.clean(); // Installers verified by an earlier session are neither trusted nor kept.
  void pruneThumbnails();
  library = new Library(store.value.root, notifyLibrary, file => shell.trashItem(file), path.join(app.getPath('userData'), 'note-recovery'));
  await library.initialize().catch(() => {}); // Missing roots are reported in the dashboard, never recreated silently.
  const executable = app.isPackaged ? path.join(process.resourcesPath, 'engine', process.platform === 'win32' ? 'syncthing.exe' : 'syncthing') : path.join(app.getAppPath(), 'vendor', `${process.platform === 'win32' ? 'win' : 'mac'}-${process.arch}`, process.platform === 'win32' ? 'syncthing.exe' : 'syncthing');
  engine = new SyncEngine({ executable, home: path.join(app.getPath('userData'), 'engine'), settings: () => store.value, updateSettings: patch => store.update(patch), port: testing ? Number(process.env.SYNCIT_TEST_PORT || 22127) : undefined, allowLoopback: testing, discovery: testing ? false : undefined, recvLimitKbps: testing && process.env.SYNCIT_TEST_RECV_KBPS ? Number(process.env.SYNCIT_TEST_RECV_KBPS) : undefined,
    arrived: items => { broadcast('syncit:library'); notifyArrival(items); }, changed: status => { broadcast('syncit:sync', status); notifyIncoming(status); tray?.setToolTip(`Satchel · ${status.incoming.length ? `Receiving ${status.incoming.length === 1 ? status.incoming[0].name : `${status.incoming.length} files`}` : status.state === 'synced' ? 'Up to date' : status.state}`); refreshTray(); } });
  companion = new Companion({ directory: app.getPath('userData'), port: store.value.phonePort ?? (testing ? 22128 : 22028), allowLoopback: testing, webRoot: path.join(app.getAppPath(), 'web'), library: () => library, text: async relative => readTextPreview(await contained(library.root, relative)), deviceName: () => store.value.deviceName, collectionName: () => path.basename(store.value.root), syncState: () => engine.status.state, thumbnail: thumbnailFor });
  if (store.value.phoneAccess) void companion.start().catch(() => {});
  setupProtocols(); setupIPC();
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !rendererRequestAllowed(details.url, devURL) }));
  session.defaultSession.setPermissionCheckHandler(() => false);
  try { registerShortcut(store.value.shortcut); } catch { /* Preferences can choose a shortcut that is not in use. */ }
  await loadWindowState();
  mainWindow = createWindow('main');
  setupTray(); placeHandle();
  screen.on('display-metrics-changed', () => placeHandle()); screen.on('display-added', () => placeHandle()); screen.on('display-removed', () => placeHandle());
  stopControl = await startControl(app.getPath('userData'), operations);
  powerMonitor.on('resume', () => { void engine.retry().catch(() => {}); });
  void engine.start().catch(() => {});
  updateActivity();
  const automaticCheck = () => { if (store.value.updateChecks && !preparingUpdate && Date.now() - (store.value.lastUpdateCheck || 0) >= 86400000) void checkUpdate().catch(() => {}); };
  updateTimer = setInterval(automaticCheck, 3600000);
  setTimeout(automaticCheck, 30000).unref();
}
async function checkUpdate() { await store.update({ lastUpdateCheck: Date.now() }); return updater.check(store.value.updatePreviews ?? false); }
/** One click from the notice or Preferences: check if nothing is offered yet, download and verify, then install. */
async function updateNow() {
  if (!updater.state.availableVersion) { const checked = await checkUpdate(); if (checked.phase !== 'available') throw new Error(checked.message || 'You have the newest release.'); }
  if (updater.state.phase !== 'ready') { const state = await updater.download(); if (state.phase !== 'ready') throw new Error(state.message || 'The download failed.'); }
  await installUpdate();
}
async function pruneThumbnails() {
  const cache = path.join(app.getPath('userData'), 'thumbnails'); const cutoff = Date.now() - 30 * 86400 * 1000;
  for (const name of await fs.readdir(cache).catch(() => [] as string[])) {
    const file = path.join(cache, name); const stat = await fs.stat(file).catch(() => null);
    if (stat?.isFile() && stat.mtimeMs < cutoff) await fs.unlink(file).catch(() => {});
  }
}
async function prepareEditors() {
  const id = randomUUID(); const pending = new Set(windows().map(window => window.webContents.id));
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => { clearTimeout(timer); ipcMain.removeListener('syncit:update-ready', listener); if (error) reject(error); else resolve(); };
    const listener = (event: Electron.IpcMainEvent, nonce: string, success: unknown) => {
      if (nonce !== id || event.senderFrame !== event.sender.mainFrame || !pending.has(event.sender.id)) return;
      if (success !== true) return finish(new Error('An open note could not be saved. Resolve its error before updating.'));
      pending.delete(event.sender.id); if (!pending.size) finish();
    };
    const timer = setTimeout(() => finish(new Error('A window is not responding. Save your notes and retry.')), 15000);
    ipcMain.on('syncit:update-ready', listener);
    windows().forEach(window => window.webContents.send('syncit:prepare-update', id, true));
    if (!pending.size) finish();
  });
}
async function installUpdate() {
  if (!app.isPackaged || !['win32', 'darwin'].includes(process.platform)) throw new Error('Installation is available in the installed Windows or macOS app.');
  if (preparingUpdate) throw new Error('Update installation is already being prepared');
  preparingUpdate = true;
  try {
    await updater.installer();
    await prepareEditors();
    await engine.stop();
    const file = await updater.installer();
    // Only the download verified a moment ago against the release's published checksums is ever installed, and only on a click.
    if (process.platform === 'darwin') {
      // The archive is unpacked with ditto, which keeps the bundle's links, permissions and signature, and swapped in for the running bundle; Satchel then relaunches itself.
      const bundle = path.resolve(app.getPath('exe'), '..', '..', '..');
      const ditto = promisify(execFile);
      const outcome = await updater.replaceBundle(file, bundle, { unpack: async (archive, into) => { await ditto('/usr/bin/ditto', ['-x', '-k', archive, into]); }, copy: async (from, to) => { await ditto('/usr/bin/ditto', [from, to]); } });
      if (!outcome.replaced) { shell.showItemInFolder(outcome.app); throw new Error(`Satchel could not replace itself: ${outcome.reason}. Drag the new Satchel from the folder that just opened to Applications, then open it.`); }
      quitting = true; app.relaunch(); setTimeout(() => app.quit(), 250);
    } else {
      // The installer runs silently once this process has quit, then starts Satchel again from the same place. The download carries no mark of the web, so no SmartScreen prompt interrupts it.
      const script = `ping -n 3 127.0.0.1 >nul & start "" /wait "${file}" /S & start "" "${process.execPath}"`;
      spawn('cmd.exe', ['/d', '/s', '/c', `"${script}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
      quitting = true; setTimeout(() => app.quit(), 250);
    }
  } catch (error) {
    preparingUpdate = false; windows().forEach(window => window.webContents.send('syncit:prepare-update', '', false));
    void engine.retry().catch(() => {}); throw error;
  }
}
/** A cached PNG rendering of an image, video or PDF in the collection, produced by the operating system's own thumbnailer. 600×480 for cards; larger sizes for full previews of formats the browser engine cannot decode (HEIC, TIFF). */
async function thumbnailFor(relative: string, width = 600, height = 480): Promise<Buffer> {
  const target = await contained(library.root, relative);
  const kind = previewKind(target);
  if (kind !== 'image' && kind !== 'video' && kind !== 'pdf') throw new Error('Unsupported media');
  const stat = await fs.stat(target);
  if (!stat.isFile() || (kind === 'image' && stat.size > 64 * 1024 * 1024)) throw new Error('Preview size limit exceeded');
  if (kind === 'image') {
    const handle = await fs.open(target, 'r');
    let dimensions: { width?: number; height?: number } = {};
    try { const header = Buffer.alloc(Math.min(stat.size, 512 * 1024)); await handle.read(header, 0, header.length, 0); try { dimensions = imageSize(header); } catch { /* Formats image-size cannot parse are still handed to the OS below. */ } }
    finally { await handle.close(); }
    if (dimensions.width && dimensions.height && (dimensions.width > 16000 || dimensions.height > 16000 || dimensions.width * dimensions.height > 80_000_000)) throw new Error('Preview dimensions exceeded');
  }
  const size = Math.min(Math.max(Math.round(width), 64), 2400) + 'x' + Math.min(Math.max(Math.round(height), 64), 2400);
  const cache = path.join(app.getPath('userData'), 'thumbnails'); await fs.mkdir(cache, { recursive: true });
  const thumbnailPath = path.join(cache, hash(`${library.root}:${relative}:${stat.mtimeMs}:${stat.size}:${size}`) + '.png');
  try { return await fs.readFile(thumbnailPath); }
  catch { const [w, h] = size.split('x').map(Number); const thumbnail = await nativeImage.createThumbnailFromPath(target, { width: w, height: h }); const bytes = thumbnail.toPNG(); if (!bytes.length) throw new Error('No preview'); await atomicWrite(thumbnailPath, bytes); return bytes; }
}
function setupProtocols() {
  const mime: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
  protocol.handle('syncit-app', async request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
    let relative: string;
    try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'; } catch { return new Response('Not found', { status: 404 }); }
    const filename = path.resolve(dist, relative);
    if (!filename.startsWith(dist + path.sep)) return new Response('Forbidden', { status: 403 });
    try { return new Response(await fs.readFile(filename), { headers: { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': appCSP } }); }
    catch { return new Response('Not found', { status: 404 }); }
  });
  protocol.handle('syncit-media', async request => {
    try {
      const url = new URL(request.url);
      if (url.hostname === 'media' && url.pathname === '/stream') {
        // Images, video, audio and PDFs are served from the collection with range support, so players seek and nothing is copied.
        const target = await contained(library.root, url.searchParams.get('path') || '');
        if (!streamable(target)) return new Response('Unsupported media', { status: 415 });
        const range = await openRange(target, request.headers.get('range'));
        return new Response(range.stream ? (Readable.toWeb(range.stream) as unknown as ReadableStream) : null, { status: range.status, headers: range.headers });
      }
      if (url.hostname !== 'image') return new Response('Not found', { status: 404 });
      const large = url.pathname === '/preview';
      const bytes = await thumbnailFor(url.searchParams.get('path') || '', large ? 1800 : 600, large ? 1800 : 480);
      return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' } });
    } catch { return new Response('Preview unavailable', { status: 404 }); }
  });
}
type Shape = 'dashboard' | 'quick' | 'mini';
const SMALL = { width: 360, height: 570 }; const MINI_HEIGHT = 230; const LARGE = { width: 1240, height: 820 }; const MIN = { width: 320, height: 210 };
/** One window, three shapes by size: under 560 px wide it is Quick drop, and under 330 px tall the minimal window. The renderer uses the same thresholds. */
function shapeOf(bounds: { width: number; height: number }): Shape { return bounds.width < 560 ? (bounds.height < 330 ? 'mini' : 'quick') : 'dashboard'; }
/** The last bounds of each shape, kept per profile, so shrinking and expanding land where they were left. */
let windowState: Partial<Record<Shape, Electron.Rectangle>> = {};
let currentShape: Shape = 'dashboard';
const stateFile = () => path.join(app.getPath('userData'), 'main-window.json');
const isRectangle = (value: unknown): value is Electron.Rectangle => !!value && typeof value === 'object' && ['x', 'y', 'width', 'height'].every(key => Number.isFinite((value as Record<string, unknown>)[key]));
function onScreen(bounds: Electron.Rectangle) { return screen.getAllDisplays().some(display => bounds.x >= display.workArea.x - 20 && bounds.y >= display.workArea.y - 20 && bounds.x < display.workArea.x + display.workArea.width - 80 && bounds.y < display.workArea.y + display.workArea.height - 80); }
async function loadWindowState() {
  try {
    const saved = JSON.parse(await fs.readFile(stateFile(), 'utf8'));
    for (const shape of ['dashboard', 'quick', 'mini'] as Shape[]) if (isRectangle(saved[shape]) && onScreen(saved[shape])) windowState[shape] = saved[shape];
    if (isRectangle(saved) && onScreen(saved) && !windowState.dashboard) windowState.dashboard = saved; // An older file held the dashboard's bounds alone.
  } catch { /* first start */ }
}
/** Keeps bounds inside the display they are on. */
function fit(bounds: Electron.Rectangle): Electron.Rectangle {
  const area = screen.getDisplayMatching(bounds).workArea;
  const width = Math.max(MIN.width, Math.min(bounds.width, area.width)); const height = Math.max(MIN.height, Math.min(bounds.height, area.height));
  return { width, height, x: Math.round(Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)), y: Math.round(Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)) };
}
/** Where a shape goes when nothing is remembered: the dashboard centred, Quick drop in the lower right corner of the display with the pointer. */
function defaultBounds(shape: Shape): Electron.Rectangle {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  if (shape === 'dashboard') { const width = Math.min(LARGE.width, area.width); const height = Math.min(LARGE.height, area.height); return { width, height, x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2) }; }
  const height = shape === 'mini' ? MINI_HEIGHT : SMALL.height;
  return { width: SMALL.width, height, x: area.x + area.width - SMALL.width - 16, y: area.y + area.height - height - 16 };
}
/** The small shapes keep on top and the chosen opacity; the dashboard never does. Crossing a threshold by dragging an edge counts as choosing that shape. */
function applyShape(window: BrowserWindow) {
  if (window.isDestroyed()) return;
  const shape = shapeOf(window.getBounds());
  if (shape === currentShape) return;
  currentShape = shape;
  const small = shape !== 'dashboard';
  window.setAlwaysOnTop(small && store.value.alwaysOnTop);
  window.setOpacity(small ? store.value.panelOpacity ?? 1 : 1);
  if (small && store.value.panelMode !== shape) void store.update({ panelMode: shape }).then(() => broadcast('syncit:settings', store.value)).catch(() => {});
}
function createWindow(kind: 'main' | 'drawer') {
  const drawer = kind === 'drawer';
  const mac = process.platform === 'darwin' && !drawer;
  const window = new BrowserWindow({ ...(drawer ? SMALL : LARGE), minWidth: MIN.width, minHeight: MIN.height, show: false, frame: mac, ...(mac ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 11 } } : {}),
    title: drawer ? 'Satchel drawer' : 'Satchel', backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e1116' : '#f8f9f6',
    icon: path.join(assets, 'icon.png'), autoHideMenuBar: true, alwaysOnTop: drawer, skipTaskbar: drawer, resizable: !drawer,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, devTools: !app.isPackaged } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => { if (!event.url.startsWith('syncit-media://media/stream')) event.preventDefault(); }); // Only the in-app PDF viewer frame may load, and only from the collection.
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  for (const event of ['show', 'hide', 'minimize', 'restore'] as const) window.on(event as 'show', updateActivity);
  if (drawer) {
    window.on('show', () => { for (const handle of handles()) handle.hide(); });
    window.on('hide', () => { clearInterval(drawerTimer); drawerOpen = false; for (const handle of handles()) handle.showInactive(); });
  } else {
    let boundsTimer: ReturnType<typeof setTimeout>;
    const remember = () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(() => { if (window.isDestroyed() || window.isMinimized() || window.isMaximized()) return; const bounds = window.getBounds(); windowState[shapeOf(bounds)] = bounds; void atomicWrite(stateFile(), JSON.stringify(windowState)).catch(() => {}); }, 400); };
    window.on('resize', () => { applyShape(window); remember(); }); window.on('move', remember);
    window.on('blur', () => { if (currentShape !== 'dashboard' && store.value.panelAutoHide && !window.isDestroyed()) window.hide(); });
    window.setBounds(fit(windowState.dashboard ?? defaultBounds('dashboard')));
  }
  void window.loadURL(devURL ? `${devURL}/?drawer=${drawer ? '1' : '0'}` : `syncit-app://app/index.html?drawer=${drawer ? '1' : '0'}`);
  if (!drawer) window.once('ready-to-show', () => { if (!process.argv.includes('--background') || !store.value.onboardingDone) window.show(); });
  return window;
}
function ensureMain() { if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow('main'); return mainWindow; }
/** Gives the window a shape: the bounds it last had in that shape, or a default place, then shows it. Quick drop and the minimal window keep each other's position. */
function setShape(shape: Shape) {
  const window = ensureMain();
  if (window.isMinimized()) window.restore();
  const current = shapeOf(window.getBounds());
  if (current !== shape && !(shape === 'dashboard' && window.isMaximized())) {
    if (window.isMaximized()) window.unmaximize();
    const bounds = window.getBounds();
    const target = current !== 'dashboard' && shape !== 'dashboard' ? { ...bounds, height: windowState[shape]?.height ?? (shape === 'mini' ? MINI_HEIGHT : SMALL.height) } : windowState[shape] ?? defaultBounds(shape);
    window.setBounds(fit(target));
  }
  applyShape(window);
  if (drawerWindow && !drawerWindow.isDestroyed() && drawerWindow.isVisible()) drawerWindow.hide(); // the drawer hands over to the window
  window.show(); window.focus();
}
function showDashboard() { setShape('dashboard'); }
function showPanel() { setShape(store.value.panelMode === 'mini' ? 'mini' : 'quick'); }
function windowControl(action: string) {
  const window = mainWindow; if (!window || window.isDestroyed()) return;
  if (action === 'minimize') window.minimize();
  else if (action === 'maximize') { if (window.isMaximized()) window.unmaximize(); else window.maximize(); }
  else if (action === 'close') window.hide();
  else throw new Error('Invalid window action');
}
const HANDLE = { width: 14, height: 180 };
const handleWindows = new Map<number, BrowserWindow>();
const handles = () => [...handleWindows.values()].filter(window => !window.isDestroyed());
function createHandle(): BrowserWindow {
  const window = new BrowserWindow({ width: HANDLE.width, height: HANDLE.height, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, title: 'Satchel handle',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, devTools: !app.isPackaged } });
  window.setAlwaysOnTop(true, 'screen-saver');
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on('close', event => { if (!quitting) event.preventDefault(); });
  void window.loadURL(devURL ? `${devURL}/?handle=1` : 'syncit-app://app/index.html?handle=1');
  window.once('ready-to-show', () => { if (!window.isDestroyed() && !drawerWindow?.isVisible()) window.showInactive(); });
  return window;
}
// A thin handle at the chosen edge of every display. Hovering it, or dragging a file onto it, slides the drawer out.
function placeHandle() {
  const edge = store.value.drawerEdge ?? 'right';
  const wanted = (testing && process.env.SYNCIT_TEST_HANDLE !== '1') || edge === 'off' || !store.value.onboardingDone ? [] : screen.getAllDisplays();
  for (const [id, window] of handleWindows) if (!wanted.some(display => display.id === id)) { if (!window.isDestroyed()) window.destroy(); handleWindows.delete(id); }
  for (const display of wanted) {
    let window = handleWindows.get(display.id);
    if (!window || window.isDestroyed()) { window = createHandle(); handleWindows.set(display.id, window); }
    const area = display.workArea;
    window.setBounds({ x: edge === 'left' ? area.x : area.x + area.width - HANDLE.width, y: Math.round(area.y + (area.height - HANDLE.height) / 2), width: HANDLE.width, height: HANDLE.height });
  }
}
// The drawer: its own small window shown flush against the handle's edge as a pile of recent items. It closes by itself
// once the pointer has left it, unless the user has clicked into it.
function showDrawer() {
  const edge = store.value.drawerEdge === 'left' ? 'left' : 'right';
  if (!drawerWindow || drawerWindow.isDestroyed()) drawerWindow = createWindow('drawer');
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [width, height] = drawerWindow.getSize();
  drawerWindow.setPosition(edge === 'left' ? area.x : area.x + area.width - width, Math.round(area.y + (area.height - height) / 2));
  drawerOpen = true;
  drawerWindow.showInactive();
  for (const handle of handles()) handle.hide();
  clearInterval(drawerTimer);
  // The drawer closes 1.5 s after the pointer leaves it. Opened from the palette or the CLI, the pointer may not be
  // in it yet: it then stays up to 12 s for the pointer to arrive before closing.
  let outside = 0, entered = false, ticks = 0;
  drawerTimer = setInterval(() => {
    if (!drawerWindow || drawerWindow.isDestroyed() || !drawerWindow.isVisible()) { clearInterval(drawerTimer); return; }
    const point = screen.getCursorScreenPoint(); const bounds = drawerWindow.getBounds();
    const inside = point.x >= bounds.x - 12 && point.x <= bounds.x + bounds.width + 12 && point.y >= bounds.y - 12 && point.y <= bounds.y + bounds.height + 12;
    if (inside) entered = true;
    outside = inside ? 0 : outside + 1; ticks++;
    if (drawerWindow.isFocused()) return;
    if ((entered && outside >= 5) || (!entered && ticks >= 40)) { clearInterval(drawerTimer); drawerWindow.hide(); }
  }, 300);
}
/** Keep on top and opacity apply to the small shapes only; a changed window size preference reshapes a small window. */
function applyPanelPreferences(resize = false) {
  const window = mainWindow;
  if (!window || window.isDestroyed() || currentShape === 'dashboard') return;
  window.setAlwaysOnTop(store.value.alwaysOnTop);
  window.setOpacity(store.value.panelOpacity ?? 1);
  if (resize && store.value.panelMode && store.value.panelMode !== currentShape) setShape(store.value.panelMode);
}
function panelAction(action: string) {
  if (!['hide', 'left', 'right'].includes(action)) throw new Error('Invalid panel action');
  if (action === 'hide') { if (currentSender && drawerWindow && !drawerWindow.isDestroyed() && currentSender === drawerWindow.webContents) drawerWindow.hide(); else mainWindow?.hide(); return; }
  showPanel();
  const window = mainWindow!;
  const area = screen.getDisplayMatching(window.getBounds()).workArea;
  const [width, height] = window.getSize();
  window.setPosition(action === 'left' ? area.x + 16 : area.x + area.width - width - 16, Math.max(area.y, area.y + area.height - height - 16));
}
function registerShortcut(accelerator: string) {
  if (testing) return;
  if (accelerator === registeredShortcut) return;
  // The shortcut: hidden, the window comes up as Quick drop; open large, it shrinks to Quick drop; open small, it goes away.
  if (!globalShortcut.register(accelerator, () => { const window = mainWindow; if (window && !window.isDestroyed() && window.isVisible() && !window.isMinimized() && currentShape !== 'dashboard') window.hide(); else showPanel(); })) throw new Error('That shortcut is already in use. Choose a different shortcut.');
  if (registeredShortcut) globalShortcut.unregister(registeredShortcut);
  registeredShortcut = accelerator;
}
let lastNotification = '';
// An optional system notification when a paired computer sends something; clicking it opens the arrivals in the dashboard.
function notifyArrival(items: { path: string; by: string }[]) {
  if (!store.value.arrivalAlerts || !items.length) return;
  const body = items.length === 1 ? `${path.posix.basename(items[0].path)} arrived from ${items[0].by}` : `${items.length} items arrived from ${items[0].by}`;
  lastNotification = body;
  if (testing || !Notification.isSupported()) return;
  const notification = new Notification({ title: 'Satchel', body, silent: true });
  notification.on('click', () => { showDashboard(); mainWindow?.webContents.send('syncit:navigate', { filter: 'arrived' }); });
  notification.show();
}
// A large file is announced once when it starts to arrive, so the wait is explained before the file lands; small ones are only announced on arrival.
const announcedIncoming = new Set<string>();
function notifyIncoming(status: SyncStatus) {
  for (const key of announcedIncoming) if (!status.incoming.some(item => item.path === key)) announcedIncoming.delete(key);
  if (!store.value.arrivalAlerts) return;
  for (const item of status.incoming) {
    if (item.size < 10 * 1048576 || announcedIncoming.has(item.path)) continue;
    announcedIncoming.add(item.path);
    const body = `${item.name} is arriving${item.from ? ` from ${item.from}` : ''} · ${formatSize(item.size)}`;
    lastNotification = body;
    if (testing || !Notification.isSupported()) continue;
    const notification = new Notification({ title: 'Satchel', body, silent: true });
    notification.on('click', () => { showDashboard(); mainWindow?.webContents.send('syncit:navigate', { filter: 'arrived' }); });
    notification.show();
  }
}
function toast(body: string) { if (Notification.isSupported()) new Notification({ title: 'Satchel', body, silent: true }).show(); }
let trayMenuSignature = '';
function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  const paused = !!store.value.syncPaused; const peers = engine?.status.peers.length ?? 0;
  const signature = `${paused}:${peers}`;
  if (signature === trayMenuSignature) return;
  trayMenuSignature = signature;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open dashboard', click: showDashboard }, { label: 'Quick drop', click: showPanel }, { label: 'Open the drawer', click: showDrawer },
    { label: 'Capture clipboard', click: () => { void (async () => { try { const result = await (operations.get('paste')!() as Promise<{ kind: string } | null>); toast(result ? result.kind === 'image' ? 'Screenshot added to the collection.' : 'Note added to the collection.' : 'The clipboard has no text or image.'); } catch (error) { toast(errorMessage(error)); } })(); } },
    { type: 'separator' },
    { label: paused ? 'Resume sync' : 'Pause sync', enabled: peers > 0 || paused, click: () => { void operations.get('settings')!({ syncPaused: !paused }); } },
    { label: 'Open collection folder', click: () => { void shell.openPath(store.value.root); } }, { type: 'separator' },
    { label: 'Quit Satchel', click: () => { quitting = true; app.quit(); } }
  ]));
}
function setupTray() {
  const icon = nativeImage.createFromPath(path.join(assets, process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Satchel');
  refreshTray();
  tray.on('double-click', showDashboard);
}
function setupIPC() {
  const bind = (name: string, callback: (...args: any[]) => any) => {
    const guarded = (...args: any[]) => { if (preparingUpdate && !['saveNote', 'readNote', 'initial', 'updateState'].includes(name)) throw new Error('Wait for update preparation to finish'); return callback(...args); };
    operations.set(name, guarded); ipcMain.handle(`syncit:${name}`, async (event, ...args) => {
    const url = event.senderFrame?.url || '';
    const allowed = windows().some(window => window.webContents === event.sender) && event.senderFrame === event.sender.mainFrame && (devURL ? new URL(url).origin === devURL : url.startsWith('syncit-app://app/'));
    if (!allowed) throw new Error('Unauthorized request');
    currentSender = event.sender;
    try { return await guarded(...args); } catch (error) { throw new Error(errorMessage(error)); }
  }); };
  operations.set('commands', () => [...operations.keys()].sort());
  operations.set('status', () => ({ version: app.getVersion(), notification: lastNotification, sync: engine.status, windows: windows().map(window => ({ name: window === drawerWindow ? 'drawer' : handles().includes(window) ? 'handle' : 'dashboard', shape: window === mainWindow ? shapeOf(window.getBounds()) : undefined, visible: window.isVisible(), bounds: window.getBounds(), alwaysOnTop: window.isAlwaysOnTop(), opacity: window.getOpacity() })), panelMode: store.value.panelMode ?? 'quick' }));
  operations.set('window', async (mode: string) => {
    if (mode === 'dashboard') showDashboard();
    else if (mode === 'drawer') showDrawer();
    else if (mode === 'quick' || mode === 'mini') { await operations.get('settings')!({ panelMode: mode }); showPanel(); }
    else if (['minimize', 'maximize', 'close'].includes(mode)) windowControl(mode);
    else panelAction(mode);
    return operations.get('status')!();
  });
  operations.set('screenshot', async (target: string) => {
    if (!['dashboard', 'panel', 'drawer'].includes(target)) throw new Error('Choose dashboard, panel or drawer');
    const window = target === 'drawer' ? drawerWindow : mainWindow; // panel is the same window as the dashboard, in whatever shape it has
    if (!window || window.isDestroyed()) throw new Error('Open the requested window first');
    const file = path.join(app.getPath('userData'), 'captures', `${target}-${Date.now()}.png`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWrite(file, (await window.webContents.capturePage()).toPNG()); return { path: file };
  });
  operations.set('quit', () => { setTimeout(() => { quitting = true; app.quit(); }, 100); return { quitting: true }; });
  bind('initial', async () => ({ settings: store.value, library: await librarySnapshot(), sync: engine.status, platform: process.platform, runId, version: app.getVersion(), drawer: drawerOpen, loginEnabled: !testing && app.getLoginItemSettings({ args: ['--background'] }).openAtLogin }));
  bind('list', () => librarySnapshot());
  bind('openDrawer', () => { showDrawer(); });
  bind('updateState', () => updater.state); bind('checkUpdate', checkUpdate); bind('downloadUpdate', () => updater.download()); bind('installUpdate', installUpdate); bind('updateNow', updateNow);
  bind('releasePage', async () => { await shell.openExternal(releasesURL); });
  bind('phoneInfo', async () => ({ enabled: !!store.value.phoneAccess, running: companion.running, port: companion.port, fingerprint: companion.fingerprint, addresses: localNetworks(testing).addresses, devices: await companion.devices(), pairing: companion.pairingActive }));
  bind('phoneOffer', async () => { if (!store.value.phoneAccess) throw new Error('Turn on phone access first'); await companion.start(); return companion.offer(); });
  bind('phoneCancelPairing', () => companion.cancelPairing());
  bind('revokePhone', (id: string) => companion.revoke(id));
  // A destination folder named by the renderer: a relative path inside the collection, checked again by the library.
  const folderArgument = (value: unknown): string => {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid folder');
    return value;
  };
  bind('importFiles', async (paths: unknown, into?: unknown) => {
    if (!Array.isArray(paths) || paths.length > 1000 || paths.some(file => typeof file !== 'string' || !path.isAbsolute(file))) throw new Error('Invalid dropped files');
    // Private app storage (engine keys, settings, the control secret) must never be copied into the synced collection.
    const normalize = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    const userData = normalize(app.getPath('userData'));
    if (paths.some(file => { const candidate = normalize(file); return candidate === userData || candidate.startsWith(userData + path.sep); })) throw new Error('Private application data cannot be added to the collection');
    await library.importFiles(paths, folderArgument(into));
  });
  bind('chooseFiles', async (kind?: unknown, into?: unknown) => {
    // The Add button and Quick drop: a system picker for files or for a folder. Picked items land in the folder being browsed, or at the top of the collection.
    const folder = kind === 'folder';
    if (kind !== undefined && kind !== 'files' && !folder) throw new Error('Invalid picker');
    const result = await dialog.showOpenDialog(mainWindow!, { title: folder ? 'Add a folder to the collection' : 'Add files to the collection', buttonLabel: 'Add', properties: folder ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'] });
    if (result.canceled || !result.filePaths.length) return 0;
    await library.importFiles(result.filePaths, folderArgument(into));
    return result.filePaths.length;
  });
  bind('paste', async () => {
    const items = await clipboard.read();
    for (const item of items) if (item.types.includes('image/png')) {
      const blob = await item.getType('image/png');
      const file = await library.addImage(Buffer.from(await (blob as Blob).arrayBuffer()));
      return { path: file, kind: 'image' };
    }
    const text = await clipboard.readText();
    if (!text.trim()) return null;
    const note = await library.createNote(text); return { path: note.path, kind: 'note' };
  });
  bind('createNote', (text: unknown) => { if (text !== undefined && typeof text !== 'string') throw new Error('Invalid note'); return library.createNote(text); });
  bind('savePasteboard', (text: unknown) => library.savePasteboard(text, store.value.deviceName));
  bind('removeClip', (id?: unknown) => library.removeClip(id));
  bind('readNote', (relative: string) => library.readNote(relative));
  bind('saveNote', (relative: string, text: string, revision: string) => { if (typeof revision !== 'string') throw new Error('Invalid note revision'); return library.saveNote(relative, text, revision); });
  bind('noteHistory', (relative: string) => library.history(relative)); bind('readNoteVersion', (id: string) => library.readVersion(id));
  bind('readText', async (relative: string) => readTextPreview(await contained(library.root, relative)));
  const follow = (from: string, to: string) => (item: string) => item === from ? to : item.startsWith(from + '/') ? to + item.slice(from.length) : item;
  const favoritesUnder = (relative: string) => store.value.favorites?.some(item => item === relative || item.startsWith(relative + '/'));
  bind('rename', async (relative: string, name: string) => { const next = await library.rename(relative, name); if (favoritesUnder(relative)) { await store.update({ favorites: store.value.favorites!.map(follow(relative, next)) }); broadcast('syncit:settings', store.value); } return next; });
  bind('createFolder', (folder: string) => library.createFolder(folder));
  bind('move', async (relatives: unknown, folder: unknown) => {
    if (!Array.isArray(relatives) || relatives.length > 500 || typeof folder !== 'string') throw new Error('Invalid move');
    const moved: string[] = [];
    for (const relative of relatives) {
      if (typeof relative !== 'string') throw new Error('Invalid path');
      const next = await library.move(relative, folder);
      if (favoritesUnder(relative)) { await store.update({ favorites: store.value.favorites!.map(follow(relative, next)) }); broadcast('syncit:settings', store.value); }
      moved.push(next);
    }
    return moved;
  });
  bind('trash', async (relative: string) => {
    await library.trash(relative);
    if (favoritesUnder(relative)) { await store.update({ favorites: store.value.favorites!.filter(item => item !== relative && !item.startsWith(relative + '/')) }); broadcast('syncit:settings', store.value); }
  });
  bind('open', async (relative: string) => { const target = await contained(library.root, relative); assertSafeToOpen(target); if (!(await fs.lstat(target)).isFile()) throw new Error('Open folders with “Show in folder”'); const error = await shell.openPath(target); if (error) throw new Error(error); });
  bind('reveal', async (relative: string) => shell.showItemInFolder(await contained(library.root, relative)));
  // Dragging a card out of the window starts an OS drag of the file itself, with its thumbnail as the drag image when one exists.
  bind('dragOut', async (relative: string | string[]) => {
    const list = Array.isArray(relative) ? relative.slice(0, 200) : [relative];
    if (!list.length) throw new Error('Nothing to drag');
    const files: string[] = [];
    for (const item of list) { if (typeof item !== 'string') throw new Error('Invalid path'); const file = await contained(library.root, item); if (!(await fs.lstat(file)).isFile()) throw new Error('Only files can be dragged out'); files.push(file); }
    let icon = nativeImage.createFromPath(path.join(assets, 'icon.png'));
    try { const thumbnail = nativeImage.createFromBuffer(await thumbnailFor(list[0], 256, 256)); if (!thumbnail.isEmpty()) icon = thumbnail; } catch { /* notes and plain files use the app icon */ }
    icon = icon.resize({ width: 96, height: 96, quality: 'good' });
    if (!testing) (currentSender && !currentSender.isDestroyed() ? currentSender : mainWindow?.webContents)?.startDrag({ file: files[0], files, icon });
    return { files };
  });
  bind('openFolder', async () => { const error = await shell.openPath(store.value.root); if (error) throw new Error(error); });
  bind('place', (placement: BoardPlacement) => library.place(placement)); bind('unpin', (relative: string) => library.unpin(relative));
  bind('panel', panelAction);
  bind('favorite', async (relative: string, enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid favorite state');
    const target = await contained(library.root, relative);
    if (!(await fs.stat(target)).isFile()) throw new Error('Favorite a file');
    const favorites = new Set(store.value.favorites || []);
    if (enabled) favorites.add(relative); else favorites.delete(relative);
    if (favorites.size > 5000) throw new Error('Favorite limit reached');
    await store.update({ favorites: [...favorites] }); broadcast('syncit:settings', store.value); return store.value;
  });
  bind('settings', async (patch: unknown) => {
    const valid = validateSettingsPatch(patch);
    if (valid.shortcut) registerShortcut(valid.shortcut);
    if (valid.startAtLogin !== undefined && !testing) {
      try { app.setLoginItemSettings({ openAtLogin: valid.startAtLogin, args: ['--background'] }); }
      catch { /* Keep the requested preference; the UI checks effective OS state and gives manual setup instructions. */ }
    }
    await store.update(valid);
    nativeTheme.themeSource = store.value.theme; applyPanelPreferences(valid.panelMode !== undefined); placeHandle();
    // Before the engine is up, start() applies the stored settings itself; reconfiguring a running engine is the only live step.
    if ((valid.deviceName || valid.localDiscovery !== undefined || valid.syncPaused !== undefined) && engine.status.deviceId) { await engine.configure(); await engine.refresh(); }
    if (valid.phoneAccess !== undefined || valid.phonePort !== undefined) { await companion.stop(); companion.port = store.value.phonePort ?? (testing ? 22128 : 22028); if (store.value.phoneAccess) await companion.start(); }
    refreshTray(); broadcast('syncit:settings', store.value); return store.value;
  });
  bind('chooseRoot', async () => {
    const config = await engine.api('/config');
    if (config.devices.some((device: { deviceID: string }) => device.deviceID !== engine.status.deviceId)) throw new Error('Choose the collection location before pairing. Moving an active collection is not supported yet.');
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null;
    const root = await fs.realpath(result.filePaths[0]);
    const normalized = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    const userData = normalized(app.getPath('userData')); const selected = normalized(root);
    if (userData === selected || userData.startsWith(selected + path.sep) || selected.startsWith(userData + path.sep)) throw new Error('The collection must not overlap private application storage');
    if (root === path.parse(root).root || root === os.homedir() || /(?:^|[\\/])(?:OneDrive[^\\/]*|Dropbox|Google Drive|Mobile Documents|CloudStorage)(?:[\\/]|$)/i.test(root)) throw new Error('Choose a dedicated local folder outside cloud storage');
    await engine.stop(); await library.close();
    const previous = store.value.root;
    try { const next = new Library(root, notifyLibrary, file => shell.trashItem(file), path.join(app.getPath('userData'), 'note-recovery')); await next.initialize(); await store.update({ root }); library = next; }
    catch (error) { library = new Library(previous, notifyLibrary, file => shell.trashItem(file), path.join(app.getPath('userData'), 'note-recovery')); await library.initialize().catch(() => {}); await engine.start().catch(() => {}); throw error; }
    await engine.start().catch(() => {}); notifyLibrary(); broadcast('syncit:settings', store.value); return store.value;
  });
  bind('shortcut', async () => {
    if (testing) return;
    const desktop = app.getPath('desktop');
    if (process.platform === 'win32') {
      if (!shell.writeShortcutLink(path.join(desktop, 'Satchel folder.lnk'), { target: store.value.root, description: 'Your local Satchel collection' })) throw new Error('Could not create the desktop shortcut');
    } else {
      const link = path.join(desktop, 'Satchel folder');
      try { await fs.symlink(store.value.root, link, 'dir'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
  });
  bind('pairingCode', () => engine.pairingCode()); bind('copyPairingCode', () => clipboard.writeText(engine.pairingCode()));
  bind('join', (code: string, localIP?: string) => engine.join(code, localIP));
  bind('connect', (id: string, address?: string, options?: unknown) => engine.connect(id, address, options));
  bind('approve', (id: string, options?: unknown) => engine.approve(id, options)); bind('reject', (id: string) => engine.reject(id));
  bind('revoke', (id: string) => engine.revoke(id));
  bind('retrySync', () => engine.retry()); bind('showPanel', showPanel); bind('showDashboard', showDashboard); bind('windowControl', (action: string) => windowControl(action));
  bind('openVersions', async () => {
    const dir = await contained(library.root, '.stversions', true);
    await fs.mkdir(dir, { recursive: true });
    const error = await shell.openPath(dir); if (error) throw new Error(error);
  });
  bind('openRecovery', async () => { const directory = path.join(app.getPath('userData'), 'note-recovery'); await fs.mkdir(directory, { recursive: true, mode: 0o700 }); const error = await shell.openPath(directory); if (error) throw new Error(error); });
}
app.on('activate', () => { if (store) showDashboard(); });
app.on('window-all-closed', () => {});
app.on('before-quit', event => {
  quitting = true;
  if (!cleanedUp) {
    event.preventDefault(); clearTimeout(scanTimer); clearInterval(updateTimer); globalShortcut.unregisterAll();
    void Promise.allSettled([stopControl?.(), updater?.stop(), companion?.stop(), library?.close(), engine?.stop()]).then(() => { cleanedUp = true; tray?.destroy(); app.quit(); });
  }
});
