import { existsSync } from 'node:fs';
import { app, BrowserWindow, Menu, Notification, Tray, ipcMain, protocol, nativeImage, clipboard, dialog, shell, globalShortcut, nativeTheme, powerMonitor, screen, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { imageSize } from 'image-size';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Library } from './library';
import { SyncEngine } from './sync-engine';
import { SettingsStore, validateSettingsPatch } from './settings';
import { contained, errorMessage, hash, atomicWrite } from './files';
import type { BoardPlacement, Settings } from '../shared/types';
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
// The app was called Sync it before 0.5. An existing profile keeps its settings, pairings and engine database under the old name.
if (!testing && !profileOverride) { const legacy = path.join(path.dirname(app.getPath('userData')), 'Sync it'); if (!existsSync(path.join(app.getPath('userData'), 'settings.json')) && existsSync(path.join(legacy, 'settings.json'))) app.setPath('userData', legacy); }
const devURL = !app.isPackaged ? process.env.SYNCIT_DEV_URL : undefined;
const assets = app.isPackaged ? path.join(process.resourcesPath, 'assets') : path.join(app.getAppPath(), 'assets');
const dist = path.join(app.getAppPath(), 'dist');
let mainWindow: BrowserWindow | undefined;
let panelWindow: BrowserWindow | undefined;
let handleWindow: BrowserWindow | undefined;
let drawerTimer: ReturnType<typeof setInterval> | undefined;
let tray: Tray | undefined;
let quitting = false;
let cleanedUp = false;
let library: Library;
let engine: SyncEngine;
let store: SettingsStore;
let scanTimer: ReturnType<typeof setTimeout>;
let registeredShortcut = '';
const windows = () => [mainWindow, panelWindow, handleWindow].filter((window): window is BrowserWindow => !!window && !window.isDestroyed());
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
async function start() {
  await secureDirectory(app.getPath('userData'));
  store = new SettingsStore(app.getPath('userData'), testing || profileOverride ? path.join(app.getPath('userData'), 'collection') : undefined);
  await store.load(); nativeTheme.themeSource = store.value.theme;
  updater = new Updates(app.getPath('userData'), app.getVersion(), state => broadcast('syncit:update', state));
  await updater.clean(); // Installers verified by an earlier session are neither trusted nor kept.
  void pruneThumbnails();
  library = new Library(store.value.root, notifyLibrary, file => shell.trashItem(file), path.join(app.getPath('userData'), 'note-recovery'));
  await library.initialize().catch(() => {}); // Missing roots are reported in the dashboard, never recreated silently.
  const executable = app.isPackaged ? path.join(process.resourcesPath, 'engine', process.platform === 'win32' ? 'syncthing.exe' : 'syncthing') : path.join(app.getAppPath(), 'vendor', `${process.platform === 'win32' ? 'win' : 'mac'}-${process.arch}`, process.platform === 'win32' ? 'syncthing.exe' : 'syncthing');
  engine = new SyncEngine({ executable, home: path.join(app.getPath('userData'), 'engine'), settings: () => store.value, updateSettings: patch => store.update(patch), port: testing ? Number(process.env.SYNCIT_TEST_PORT || 22127) : undefined, discovery: testing ? false : undefined,
    arrived: () => broadcast('syncit:library'), changed: status => { broadcast('syncit:sync', status); tray?.setToolTip(`Satchel · ${status.state === 'synced' ? 'Up to date' : status.state}`); refreshTray(); } });
  companion = new Companion({ directory: app.getPath('userData'), port: store.value.phonePort ?? (testing ? 22128 : 22028), allowLoopback: testing, webRoot: path.join(app.getAppPath(), 'web'), library: () => library, text: async relative => readTextPreview(await contained(library.root, relative)), deviceName: () => store.value.deviceName, collectionName: () => path.basename(store.value.root), syncState: () => engine.status.state, thumbnail: thumbnailFor });
  if (store.value.phoneAccess) void companion.start().catch(() => {});
  setupProtocols(); setupIPC();
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !rendererRequestAllowed(details.url, devURL) }));
  session.defaultSession.setPermissionCheckHandler(() => false);
  try { registerShortcut(store.value.shortcut); } catch { /* Preferences can choose a shortcut that is not in use. */ }
  mainWindow = createWindow(false);
  setupTray(); placeHandle();
  screen.on('display-metrics-changed', () => placeHandle());
  stopControl = await startControl(app.getPath('userData'), operations);
  powerMonitor.on('resume', () => { void engine.retry().catch(() => {}); });
  void engine.start().catch(() => {});
  updateActivity();
  const automaticCheck = () => { if (store.value.updateChecks && !preparingUpdate && Date.now() - (store.value.lastUpdateCheck || 0) >= 86400000) void checkUpdate().catch(() => {}); };
  updateTimer = setInterval(automaticCheck, 3600000);
  setTimeout(automaticCheck, 30000).unref();
}
async function checkUpdate() { await store.update({ lastUpdateCheck: Date.now() }); return updater.check(store.value.updatePreviews ?? false); }
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
    // Windows: the normal interactive NSIS installer handles replacement and offers launch.
    // macOS: the verified disk image is mounted and opened; the user drags Satchel to Applications.
    // Do not silently install or bypass the OS's unsigned-publisher warning.
    const error = await shell.openPath(file); if (error) throw new Error(error);
    quitting = true; setTimeout(() => app.quit(), 250);
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
function createWindow(panel: boolean) {
  const stateFile = path.join(app.getPath('userData'), panel ? 'panel-window.json' : 'main-window.json');
  const mini = panel && store.value.panelMode === 'mini';
  const window = new BrowserWindow({ width: panel ? 360 : 1240, height: panel ? (mini ? 230 : 570) : 820, minWidth: panel ? 320 : 860, minHeight: panel ? (mini ? 210 : 460) : 600, show: false, frame: !panel,
    title: panel ? 'Satchel · Quick drop' : 'Satchel', backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e1116' : '#f8f9f6',
    icon: path.join(assets, 'icon.png'), autoHideMenuBar: true, alwaysOnTop: panel && store.value.alwaysOnTop,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, devTools: !app.isPackaged } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => { if (!event.url.startsWith('syncit-media://media/stream')) event.preventDefault(); }); // Only the in-app PDF viewer frame may load, and only from the collection.
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  for (const event of ['show', 'hide', 'minimize', 'restore'] as const) window.on(event as 'show', updateActivity);
  if (panel) {
    window.setOpacity(store.value.panelOpacity ?? 1);
    window.on('blur', () => { if (store.value.panelAutoHide) window.hide(); });
    window.on('show', () => handleWindow?.hide());
    window.on('hide', () => { clearInterval(drawerTimer); if (!window.isDestroyed()) window.webContents.send('syncit:drawer', false); if (handleWindow && !handleWindow.isDestroyed()) handleWindow.showInactive(); });
  }
  let boundsTimer: ReturnType<typeof setTimeout>;
  window.on('resize', persistBounds); window.on('move', persistBounds);
  function persistBounds() { clearTimeout(boundsTimer); boundsTimer = setTimeout(() => { if (!window.isDestroyed()) void atomicWrite(stateFile, JSON.stringify(window.getBounds())).catch(() => {}); }, 500); }
  void fs.readFile(stateFile, 'utf8').then(content => {
    const saved = JSON.parse(content);
    if (!panel && Number.isFinite(saved.width) && Number.isFinite(saved.height)) window.setSize(Math.max(860, Math.min(2400, saved.width)), Math.max(600, Math.min(1600, saved.height)));
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y) && screen.getAllDisplays().some(display => saved.x >= display.workArea.x && saved.y >= display.workArea.y && saved.x < display.workArea.x + display.workArea.width - 80 && saved.y < display.workArea.y + display.workArea.height - 80)) window.setPosition(saved.x, saved.y);
  }).catch(() => {});
  void window.loadURL(devURL ? `${devURL}/?panel=${panel ? '1' : '0'}` : `syncit-app://app/index.html?panel=${panel ? '1' : '0'}`);
  // Panel visibility is owned by showPanel/hide; delayed load must not reopen a
  // panel that a CLI command or blur handler has already hidden.
  window.once('ready-to-show', () => { if (!panel && (!process.argv.includes('--background') || !store.value.onboardingDone)) window.show(); });
  return window;
}
function showDashboard() { if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow(false); if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
const HANDLE = { width: 14, height: 180 };
// A thin handle at a screen edge. Hovering it, or dragging a file onto it, slides the drawer out.
function placeHandle() {
  const edge = store.value.drawerEdge ?? 'right';
  if (testing || edge === 'off' || !store.value.onboardingDone) { if (handleWindow && !handleWindow.isDestroyed()) handleWindow.destroy(); handleWindow = undefined; return; }
  if (!handleWindow || handleWindow.isDestroyed()) {
    handleWindow = new BrowserWindow({ width: HANDLE.width, height: HANDLE.height, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, title: 'Satchel drawer',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, devTools: !app.isPackaged } });
    handleWindow.setAlwaysOnTop(true, 'screen-saver');
    handleWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    handleWindow.webContents.on('will-navigate', event => event.preventDefault());
    handleWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    handleWindow.on('close', event => { if (!quitting) event.preventDefault(); });
    void handleWindow.loadURL(devURL ? `${devURL}/?handle=1` : 'syncit-app://app/index.html?handle=1');
    handleWindow.once('ready-to-show', () => { if (handleWindow && !handleWindow.isDestroyed() && !panelWindow?.isVisible()) handleWindow.showInactive(); });
  }
  const area = screen.getPrimaryDisplay().workArea;
  handleWindow.setBounds({ x: edge === 'left' ? area.x : area.x + area.width - HANDLE.width, y: Math.round(area.y + (area.height - HANDLE.height) / 2), width: HANDLE.width, height: HANDLE.height });
}
// The drawer: the Quick drop window shown flush against the handle's edge as a pile of recent items. It closes by itself
// once the pointer has left it, unless the user has clicked into it.
function showDrawer() {
  const edge = store.value.drawerEdge === 'left' ? 'left' : 'right';
  if (!panelWindow || panelWindow.isDestroyed()) panelWindow = createWindow(true);
  const area = screen.getPrimaryDisplay().workArea;
  const [width, height] = panelWindow.getSize();
  panelWindow.setPosition(edge === 'left' ? area.x : area.x + area.width - width, Math.round(area.y + (area.height - height) / 2));
  panelWindow.webContents.send('syncit:drawer', true);
  panelWindow.showInactive();
  handleWindow?.hide();
  clearInterval(drawerTimer);
  // The drawer closes 1.5 s after the pointer leaves it. Opened from the palette or the CLI, the pointer may not be
  // in it yet: it then stays up to 12 s for the pointer to arrive before closing.
  let outside = 0, entered = false, ticks = 0;
  drawerTimer = setInterval(() => {
    if (!panelWindow || panelWindow.isDestroyed() || !panelWindow.isVisible()) { clearInterval(drawerTimer); return; }
    const point = screen.getCursorScreenPoint(); const bounds = panelWindow.getBounds();
    const inside = point.x >= bounds.x - 12 && point.x <= bounds.x + bounds.width + 12 && point.y >= bounds.y - 12 && point.y <= bounds.y + bounds.height + 12;
    if (inside) entered = true;
    outside = inside ? 0 : outside + 1; ticks++;
    if (panelWindow.isFocused()) return;
    if ((entered && outside >= 5) || (!entered && ticks >= 40)) { clearInterval(drawerTimer); panelWindow.hide(); }
  }, 300);
}
function showPanel() { if (!panelWindow || panelWindow.isDestroyed()) panelWindow = createWindow(true); panelWindow.show(); panelWindow.focus(); }
function applyPanelPreferences(resize = false) {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  panelWindow.setAlwaysOnTop(store.value.alwaysOnTop);
  panelWindow.setOpacity(store.value.panelOpacity ?? 1);
  if (resize) { const mini = store.value.panelMode === 'mini'; panelWindow.setMinimumSize(320, mini ? 210 : 460); panelWindow.setSize(360, mini ? 230 : 570); }
}
function panelAction(action: string) {
  if (!['hide', 'left', 'right'].includes(action)) throw new Error('Invalid panel action');
  if (action === 'hide') { panelWindow?.hide(); return; }
  showPanel();
  const area = screen.getDisplayMatching(panelWindow!.getBounds()).workArea;
  const [width, height] = panelWindow!.getSize();
  panelWindow!.setPosition(action === 'left' ? area.x + 16 : area.x + area.width - width - 16, Math.max(area.y, area.y + area.height - height - 16));
}
function registerShortcut(accelerator: string) {
  if (testing) return;
  if (accelerator === registeredShortcut) return;
  if (!globalShortcut.register(accelerator, () => panelWindow?.isVisible() ? panelWindow.hide() : showPanel())) throw new Error('That shortcut is already in use. Choose a different shortcut.');
  if (registeredShortcut) globalShortcut.unregister(registeredShortcut);
  registeredShortcut = accelerator;
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
    { label: 'Open dashboard', click: showDashboard }, { label: 'Quick drop', click: showPanel },
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
    try { return await guarded(...args); } catch (error) { throw new Error(errorMessage(error)); }
  }); };
  operations.set('commands', () => [...operations.keys()].sort());
  operations.set('status', () => ({ version: app.getVersion(), sync: engine.status, windows: windows().map(window => ({ name: window === panelWindow ? 'panel' : window === handleWindow ? 'handle' : 'dashboard', visible: window.isVisible(), bounds: window.getBounds(), alwaysOnTop: window.isAlwaysOnTop(), opacity: window.getOpacity() })), panelMode: store.value.panelMode ?? 'quick' }));
  operations.set('window', async (mode: string) => {
    if (mode === 'dashboard') showDashboard();
    else if (mode === 'drawer') showDrawer();
    else if (mode === 'quick' || mode === 'mini') { await operations.get('settings')!({ panelMode: mode }); showPanel(); }
    else panelAction(mode);
    return operations.get('status')!();
  });
  operations.set('screenshot', async (target: string) => {
    if (!['dashboard', 'panel'].includes(target)) throw new Error('Choose dashboard or panel');
    const window = target === 'panel' ? panelWindow : mainWindow;
    if (!window || window.isDestroyed()) throw new Error('Open the requested window first');
    const file = path.join(app.getPath('userData'), 'captures', `${target}-${Date.now()}.png`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWrite(file, (await window.webContents.capturePage()).toPNG()); return { path: file };
  });
  operations.set('quit', () => { setTimeout(() => { quitting = true; app.quit(); }, 100); return { quitting: true }; });
  bind('initial', async () => ({ settings: store.value, library: await librarySnapshot(), sync: engine.status, platform: process.platform, runId, version: app.getVersion(), loginEnabled: !testing && app.getLoginItemSettings({ args: ['--background'] }).openAtLogin }));
  bind('list', () => librarySnapshot());
  bind('openDrawer', () => { showDrawer(); });
  bind('updateState', () => updater.state); bind('checkUpdate', checkUpdate); bind('downloadUpdate', () => updater.download()); bind('installUpdate', installUpdate);
  bind('releasePage', async () => { await shell.openExternal(releasesURL); });
  bind('phoneInfo', async () => ({ enabled: !!store.value.phoneAccess, running: companion.running, port: companion.port, fingerprint: companion.fingerprint, addresses: localNetworks(testing).addresses, devices: await companion.devices(), pairing: companion.pairingActive }));
  bind('phoneOffer', async () => { if (!store.value.phoneAccess) throw new Error('Turn on phone access first'); await companion.start(); return companion.offer(); });
  bind('phoneCancelPairing', () => companion.cancelPairing());
  bind('revokePhone', (id: string) => companion.revoke(id));
  bind('importFiles', async (paths: unknown) => {
    if (!Array.isArray(paths) || paths.length > 1000 || paths.some(file => typeof file !== 'string' || !path.isAbsolute(file))) throw new Error('Invalid dropped files');
    // Private app storage (engine keys, settings, the control secret) must never be copied into the synced collection.
    const normalize = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    const userData = normalize(app.getPath('userData'));
    if (paths.some(file => { const candidate = normalize(file); return candidate === userData || candidate.startsWith(userData + path.sep); })) throw new Error('Private application data cannot be added to the collection');
    await library.importFiles(paths);
  });
  bind('chooseFiles', async () => { const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile', 'multiSelections'] }); if (!result.canceled) await library.importFiles(result.filePaths); });
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
  bind('readNote', (relative: string) => library.readNote(relative));
  bind('saveNote', (relative: string, text: string, revision: string) => { if (typeof revision !== 'string') throw new Error('Invalid note revision'); return library.saveNote(relative, text, revision); });
  bind('noteHistory', (relative: string) => library.history(relative)); bind('readNoteVersion', (id: string) => library.readVersion(id));
  bind('readText', async (relative: string) => readTextPreview(await contained(library.root, relative)));
  bind('rename', async (relative: string, name: string) => { const next = await library.rename(relative, name); if (store.value.favorites?.includes(relative)) { await store.update({ favorites: store.value.favorites.map(item => item === relative ? next : item) }); broadcast('syncit:settings', store.value); } return next; });
  bind('trash', async (relative: string) => {
    await library.trash(relative);
    if (store.value.favorites?.includes(relative)) { await store.update({ favorites: store.value.favorites.filter(item => item !== relative) }); broadcast('syncit:settings', store.value); }
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
    if (!testing) mainWindow?.webContents.startDrag({ file: files[0], files, icon });
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
  bind('retrySync', () => engine.retry()); bind('showPanel', showPanel); bind('showDashboard', showDashboard);
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
