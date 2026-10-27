import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { SyncItAPI } from '../shared/types';
const invoke = (name: string, ...args: unknown[]) => ipcRenderer.invoke(`syncit:${name}`, ...args);
const listen = (name: string, callback: (payload: any) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
  ipcRenderer.on(name, handler); return () => ipcRenderer.removeListener(name, handler);
};
const api: SyncItAPI = {
  initial: () => invoke('initial'), list: () => invoke('list'),
  importFiles: paths => invoke('importFiles', paths), chooseFiles: () => invoke('chooseFiles'), paste: () => invoke('paste'),
  createNote: text => invoke('createNote', text), readNote: path => invoke('readNote', path), saveNote: (path, text, revision) => invoke('saveNote', path, text, revision),
  noteHistory: path => invoke('noteHistory', path), readNoteVersion: id => invoke('readNoteVersion', id), readText: path => invoke('readText', path),
  rename: (path, name) => invoke('rename', path, name), trash: path => invoke('trash', path), open: path => invoke('open', path), reveal: path => invoke('reveal', path), dragOut: path => invoke('dragOut', path),
  openFolder: () => invoke('openFolder'), place: placement => invoke('place', placement), unpin: path => invoke('unpin', path),
  settings: patch => invoke('settings', patch), chooseRoot: () => invoke('chooseRoot'), shortcut: () => invoke('shortcut'),
  pairingCode: () => invoke('pairingCode'), copyPairingCode: () => invoke('copyPairingCode'), join: (code, localIP) => invoke('join', code, localIP),
  connect: (id, address, options) => invoke('connect', id, address, options),
  approve: (id, options) => invoke('approve', id, options), reject: id => invoke('reject', id), retrySync: () => invoke('retrySync'),
  revoke: id => invoke('revoke', id), openRecovery: () => invoke('openRecovery'),
  showPanel: () => invoke('showPanel'), showDashboard: () => invoke('showDashboard'), openVersions: () => invoke('openVersions'),
  panel: action => invoke('panel', action), favorite: (path, enabled) => invoke('favorite', path, enabled),
  updateState: () => invoke('updateState'), checkUpdate: () => invoke('checkUpdate'), downloadUpdate: () => invoke('downloadUpdate'), installUpdate: () => invoke('installUpdate'), releasePage: () => invoke('releasePage'),
  phoneInfo: () => invoke('phoneInfo'), phoneOffer: () => invoke('phoneOffer'), phoneCancelPairing: () => invoke('phoneCancelPairing'), revokePhone: id => invoke('revokePhone', id),
  onUpdate: callback => listen('syncit:update', callback),
  onPrepareUpdate: callback => {
    const handler = async (_event: Electron.IpcRendererEvent, id: string, prepare: boolean) => {
      try { await callback(prepare); if (prepare) ipcRenderer.send('syncit:update-ready', id, true); }
      catch { if (prepare) ipcRenderer.send('syncit:update-ready', id, false); }
    };
    ipcRenderer.on('syncit:prepare-update', handler); return () => ipcRenderer.removeListener('syncit:prepare-update', handler);
  },
  pathsForFiles: files => Array.from(files).map(file => webUtils.getPathForFile(file)).filter(Boolean),
  onLibrary: callback => listen('syncit:library', callback), onSync: callback => listen('syncit:sync', callback), onSettings: callback => listen('syncit:settings', callback)
};
contextBridge.exposeInMainWorld('syncit', api);
