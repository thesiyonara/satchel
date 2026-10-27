export type ItemKind = 'note' | 'image' | 'video' | 'audio' | 'file';
export interface LibraryItem {
  path: string; name: string; kind: ItemKind; size: number; modifiedAt: number;
  preview?: string; conflict: boolean;
  /** Set when the latest change came from another computer in the last two days. */
  arrivedAt?: number; arrivedFrom?: string;
}
export interface BoardPlacement { version: 1; path: string; x: number; y: number; width: number; height: number; updatedAt: number }
export interface LibrarySnapshot { items: LibraryItem[]; placements: BoardPlacement[]; error?: string }
export interface NoteDocument { path: string; text: string; revision: string; conflict?: boolean }
/** A previous version of a note: a local pre-save copy, or a version Syncthing archived when a received change replaced it. */
export interface NoteVersion { id: string; source: 'local' | 'received'; time: number; size: number }
export interface Settings {
  version: 1; root: string; folderId: string; deviceName: string; onboardingDone: boolean;
  startAtLogin: boolean; alwaysOnTop: boolean; shortcut: string; theme: 'system' | 'light' | 'dark';
  localDiscovery?: boolean; syncPaused?: boolean;
  panelMode?: 'quick' | 'mini'; panelOpacity?: number; panelAutoHide?: boolean; favorites?: string[];
  /** The screen edge that carries the drawer handle. */
  drawerEdge?: 'off' | 'left' | 'right';
  updateChecks?: boolean; updatePreviews?: boolean; lastUpdateCheck?: number;
  phoneAccess?: boolean; phonePort?: number;
}
/** A phone paired for on-demand access. The phone holds a bearer token; only its hash is stored. */
export interface PhoneDeviceInfo { id: string; name: string; pairedAt: number; lastSeen?: number }
/** What a phone needs to pair: where to connect, which certificate to pin, and a one-time code. `url` opens the web client and pairs on load; the QR code carries it. */
export interface PhoneOffer { version: 1; name: string; addresses: string[]; port: number; fingerprint: string; code: string; expires: number; url: string }
export interface PhoneInfo { enabled: boolean; running: boolean; port: number; fingerprint: string; addresses: string[]; devices: PhoneDeviceInfo[]; pairing: boolean }
export interface Peer { id: string; name: string; connected: boolean; completion: number; encrypted: boolean }
export interface PendingPeer { id: string; name: string; address: string }
/** A device announcing itself on the local network that is not paired, pending or ignored. Its name is unknown until it connects. */
export interface NearbyDevice { id: string; addresses: string[] }
/** Options when approving or connecting a device. An encryption password makes that device an untrusted copy: it stores and relays only encrypted data. */
export interface PairingOptions { encryptionPassword?: string }
export interface SyncStatus {
  state: 'starting' | 'unpaired' | 'offline' | 'syncing' | 'synced' | 'error' | 'paused';
  deviceId: string; peers: Peer[]; pending: PendingPeer[]; nearby: NearbyDevice[]; pendingItems: number; pendingBytes: number;
  localAddresses: string[]; errors: string[]; engineVersion: string;
}
export interface InitialState { settings: Settings; library: LibrarySnapshot; sync: SyncStatus; platform: string; loginEnabled: boolean; runId: string; version: string; /** The Quick drop window was opened as the drawer and should show the pile. */ drawer?: boolean }
export interface UpdateState { phase: 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'ready' | 'error' | 'unsupported'; currentVersion: string; availableVersion?: string; message?: string; checkedAt?: number }
export interface SyncItAPI {
  initial(): Promise<InitialState>;
  list(): Promise<LibrarySnapshot>;
  importFiles(paths: string[]): Promise<void>;
  dragOut(paths: string | string[]): Promise<{ files: string[] }>;
  openDrawer(): Promise<void>;
  onDrawer(callback: (pile: boolean) => void): () => void;
  chooseFiles(): Promise<void>;
  paste(): Promise<{ path: string; kind: ItemKind } | null>;
  createNote(text?: string): Promise<NoteDocument>;
  readNote(path: string): Promise<NoteDocument>;
  saveNote(path: string, text: string, revision: string): Promise<NoteDocument>;
  noteHistory(path: string): Promise<NoteVersion[]>;
  readText(path: string): Promise<string>;
  readNoteVersion(id: string): Promise<string>;
  rename(path: string, name: string): Promise<string>;
  trash(path: string): Promise<void>;
  open(path: string): Promise<void>;
  reveal(path: string): Promise<void>;
  openFolder(): Promise<void>;
  place(placement: BoardPlacement): Promise<void>;
  unpin(path: string): Promise<void>;
  settings(patch: Partial<Settings>): Promise<Settings>;
  chooseRoot(): Promise<Settings | null>;
  shortcut(): Promise<void>;
  pairingCode(): Promise<string>;
  copyPairingCode(): Promise<void>;
  join(code: string, localIP?: string): Promise<void>;
  connect(id: string, address?: string, options?: PairingOptions): Promise<void>;
  approve(id: string, options?: PairingOptions): Promise<void>;
  reject(id: string): Promise<void>;
  revoke(id: string): Promise<void>;
  retrySync(): Promise<void>;
  showPanel(): Promise<void>;
  panel(action: 'hide' | 'left' | 'right'): Promise<void>;
  favorite(path: string, enabled: boolean): Promise<Settings>;
  showDashboard(): Promise<void>;
  openVersions(): Promise<void>;
  openRecovery(): Promise<void>;
  updateState(): Promise<UpdateState>;
  checkUpdate(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  releasePage(): Promise<void>;
  phoneInfo(): Promise<PhoneInfo>;
  phoneOffer(): Promise<{ offer: PhoneOffer; encoded: string }>;
  phoneCancelPairing(): Promise<void>;
  revokePhone(id: string): Promise<void>;
  onUpdate(callback: (state: UpdateState) => void): () => void;
  onPrepareUpdate(callback: (prepare: boolean) => Promise<void>): () => void;
  pathsForFiles(files: File[]): string[];
  onLibrary(callback: () => void): () => void;
  onSync(callback: (state: SyncStatus) => void): () => void;
  onSettings(callback: (settings: Settings) => void): () => void;
}
