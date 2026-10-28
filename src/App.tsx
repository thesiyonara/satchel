import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, CheckCheck, Clipboard, File, FileText, Film, Folder, FolderOpen, FolderPlus, Image, LayoutGrid, Link2, LoaderCircle, MoreHorizontal, Music, PanelTop, Pin, Play, Plus, Search, Trash2, WifiOff, X, AlertTriangle, Pencil, ExternalLink, Star, Command } from 'lucide-react';
import type { IncomingItem, InitialState, ItemKind, LibraryItem, LibrarySnapshot, NoteDocument, Settings, SyncStatus, UpdateState } from '../shared/types';
import { NoteEditor } from './NoteEditor';
import { SettingsPanel } from './SettingsPanel';
import { Board } from './Board';
import { recoverDrafts } from './drafts';
import { QuickPanel } from './QuickPanel';
import { CommandPalette } from './CommandPalette';
import { saveBeforeUpdate } from './save-before-update';
import { PreviewBody, previewLabel } from './Preview';
import { mediaKind, previewKind } from '../shared/media';
import { formatSize } from '../shared/format';
import { plainText } from './markdown-parse';
import { Mark } from './Mark';

const isPanel = new URLSearchParams(location.search).get('panel') === '1';
const emptyLibrary: LibrarySnapshot = { items: [], placements: [] };
export const labels: Record<SyncStatus['state'], string> = { starting: 'Starting the sync engine', unpaired: 'No computer paired yet', offline: 'Paired computers are offline', syncing: 'Syncing', synced: 'Up to date', error: 'Sync needs attention', paused: 'Sync paused' };
type Filter = ItemKind | 'all' | 'conflict' | 'favorite' | 'arrived';
const filterTitles: Record<Filter, string> = { all: 'Everything', favorite: 'Favorites', conflict: 'Conflicts', arrived: 'From other computers', note: 'Notes', image: 'Images', video: 'Videos', audio: 'Audio', file: 'Files' };

export const size = formatSize;
function since(time: number) { const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000)); return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function title(item: LibraryItem) { return item.kind === 'note' ? item.name.replace(/\.(md|txt)$/i, '') : item.name; }
function folderOf(path: string) { const index = path.lastIndexOf('/'); return index < 0 ? '' : path.slice(0, index); }
export function collectionName(root: string) { return root.split(/[\\/]/).filter(Boolean).at(-1) || root; }
function notePreview(item: LibraryItem) {
  const lines = plainText(item.preview || '').split('\n');
  if (lines[0]?.trim() === title(item)) lines.shift();
  return lines.join('\n').trim() || 'Empty note';
}
function media(item: LibraryItem) { return `syncit-media://image/thumbnail?path=${encodeURIComponent(item.path)}&v=${item.modifiedAt}`; }

export function Brand({ compact = false }: { compact?: boolean }) { return <div className="brand"><Mark size={30} />{!compact && <span>Satchel</span>}</div>; }

export function App() {
  const [preparingUpdate, setPreparingUpdate] = useState(false);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  useEffect(() => {
    void window.syncit.updateState().then(setUpdate);
    const offState = window.syncit.onUpdate(setUpdate);
    const offPrepare = window.syncit.onPrepareUpdate(async prepare => {
      setPreparingUpdate(prepare);
      if (prepare) { (document.activeElement as HTMLElement)?.blur(); await saveBeforeUpdate(); }
    });
    return () => { offState(); offPrepare(); };
  }, []);
  const [initial, setInitial] = useState<InitialState | null>(null);
  const [library, setLibrary] = useState<LibrarySnapshot>(emptyLibrary);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [view, setView] = useState<'grid' | 'board'>('grid');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [palette, setPalette] = useState(false);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette(value => !value); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
  const [note, setNote] = useState<NoteDocument | null>(null);
  const [preview, setPreview] = useState<LibraryItem | null>(null);
  const [mediaError, setMediaError] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'connect' | 'preferences' | null>(null);
  const [toast, setToast] = useState('');
  const [fatal, setFatal] = useState('');
  const [dragging, setDragging] = useState(false);
  const [pile, setPile] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  // Any open menu (Add, a card's actions) closes on a click elsewhere.
  useEffect(() => {
    const close = (event: PointerEvent) => { document.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(menu => { if (!menu.contains(event.target as Node)) menu.removeAttribute('open'); }); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  useEffect(() => window.syncit.onDrawer(setPile), []);
  useEffect(() => window.syncit.onNavigate(target => { if (target.filter === 'arrived') { setView('grid'); setFilter('arrived'); setFolder(null); } }), []);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected([]); }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
  const visibleRef = useRef<LibraryItem[]>([]); const selectedRef = useRef<string[]>([]);
  // Ctrl/⌘ A selects everything in view; Delete asks to trash the selection. Neither applies inside text fields or while a dialog or note is open.
  useEffect(() => { const handler = (event: KeyboardEvent) => {
    if (isPanel || (event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]') || document.querySelector('.modal-shade, .note-pane')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(visibleRef.current.map(item => item.path)); }
    else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedRef.current.length) { event.preventDefault(); setDeleting(visibleRef.current.filter(item => selectedRef.current.includes(item.path))); }
  }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
  const [busy, setBusy] = useState(false);
  const [rename, setRename] = useState<LibraryItem | null>(null); const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<LibraryItem[] | null>(null);
  const [moving, setMoving] = useState<string[] | null>(null); const [moveTarget, setMoveTarget] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const lastClicked = useRef<string | null>(null);
  const [loginChoice, setLoginChoice] = useState(true); const [shortcutChoice, setShortcutChoice] = useState(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const requestSequence = useRef(0);
  const dragDepth = useRef(0);
  const internalDrag = useRef(false);
  useEffect(() => {
    const start = (event: DragEvent) => { if (!event.defaultPrevented) internalDrag.current = true; };
    const end = () => { setTimeout(() => { internalDrag.current = false; }, 0); };
    window.addEventListener('dragstart', start); window.addEventListener('dragend', end); window.addEventListener('drop', end);
    return () => { window.removeEventListener('dragstart', start); window.removeEventListener('dragend', end); window.removeEventListener('drop', end); };
  }, []);
  const notify = useCallback((message: string) => { setToast(message.replace(/^Error: Error invoking remote method '[^']+': Error: /, '').replace(/^Error: /, '')); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 6500); }, []);
  const refresh = useCallback(async () => { const sequence = ++requestSequence.current; const snapshot = await window.syncit.list(); if (sequence === requestSequence.current) setLibrary(snapshot); }, []);
  useEffect(() => {
    if (!window.syncit) { setFatal('Open Satchel as a desktop app using npm run dev.'); return; }
    void window.syncit.initial().then(data => { setInitial(data); setSettings(data.settings); setSync(data.sync); setLibrary(data.library); if (isPanel && data.drawer) setPile(true); }).catch(error => setFatal(String(error)));
    const unsubscribers = [window.syncit.onLibrary(() => { void refresh().catch(error => notify(String(error))); }), window.syncit.onSync(setSync), window.syncit.onSettings(setSettings)];
    return () => { unsubscribers.forEach(unsubscribe => unsubscribe()); clearTimeout(toastTimer.current); };
  }, [notify, refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme || 'system';
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { if (media.matches) document.documentElement.dataset.dark = ''; else delete document.documentElement.dataset.dark; };
    apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply);
  }, [settings?.theme]);
  useEffect(() => {
    if (initial && !isPanel) void recoverDrafts(initial.runId, initial.settings.root).then(count => { if (count) { notify(`Recovered ${count} unsaved ${count === 1 ? 'note' : 'notes'} from the previous session.`); void refresh(); } });
  }, [initial, notify, refresh]);
  // Where new items land: the folder being browsed in Everything, otherwise the top of the collection.
  const currentFolder = () => view === 'grid' && filter === 'all' && !search && folder ? folder : undefined;
  const added = (count: number, kind: 'items' | 'folders', into?: string) => `${kind === 'folders' ? (count === 1 ? 'Folder' : `${count} folders`) : `${count} ${count === 1 ? 'item' : 'items'}`} added to ${into || 'the collection'}.`;
  // The Add button: the system picker for files or a folder.
  async function choose(kind: 'files' | 'folder') {
    document.querySelector('details.add-menu')?.removeAttribute('open');
    const into = currentFolder();
    await run(async () => { const count = await window.syncit.chooseFiles(kind, into); if (count) notify(added(count, kind === 'folder' ? 'folders' : 'items', into)); });
  }
  async function run(action: () => Promise<unknown>, success?: string) { setBusy(true); try { await action(); if (success) notify(success); } catch (error) { notify(String(error)); } finally { setBusy(false); } }
  async function openItem(item: LibraryItem) { if (isPanel && settings?.panelMode === 'mini') await window.syncit.settings({ panelMode: 'quick' }); if (item.kind === 'note') setNote(await window.syncit.readNote(item.path)); else if (previewKind(item.name)) { setMediaError(false); setPreview(item); } else await window.syncit.open(item.path); }
  async function paste() { const result = await window.syncit.paste(); notify(result ? result.kind === 'image' ? 'Screenshot added to the collection.' : 'Note added to the collection.' : 'The clipboard has no text or image to add.'); }
  async function drop(event: React.DragEvent) {
    event.preventDefault(); setDragging(false); dragDepth.current = 0;
    if (internalDrag.current || event.dataTransfer.types.includes('application/x-syncit-item')) return;
    const dropped = window.syncit.pathsForFiles(Array.from(event.dataTransfer.files));
    const fold = (value: string) => initial?.platform === 'win32' ? value.replace(/\//g, '\\').toLowerCase() : value;
    const root = settings ? fold(settings.root).replace(/[\\/]+$/, '') : '';
    const paths = dropped.filter(file => { const candidate = fold(file); return !(root && (candidate === root || candidate.startsWith(root + (initial?.platform === 'win32' ? '\\' : '/')))); });
    if (dropped.length && !paths.length) { notify(dropped.length === 1 ? 'That file is already in the collection.' : 'Those files are already in the collection.'); return; }
    if (paths.length) { const into = isPanel ? undefined : currentFolder(); await run(() => window.syncit.importFiles(paths, into), added(paths.length, 'items', into)); if (isPanel && pile) setTimeout(() => void window.syncit.panel('hide'), 1400); }
    else { const text = event.dataTransfer.getData('text/plain'); if (text.trim() && !/^syncit-(media|app):/i.test(text.trim())) await run(() => window.syncit.createNote(text), 'Note added to the collection.'); }
  }
  // A file another computer is sending: its name, who sends it and how far it has come, in place of the card it will become.
  function renderIncoming(item: IncomingItem) {
    const kind: ItemKind = mediaKind(item.name) || (/\.(md|txt)$/i.test(item.name) ? 'note' : 'file');
    const Icon = { note: FileText, image: Image, video: Film, audio: Music, file: File }[kind];
    const percent = item.size > 0 ? Math.min(100, Math.round(item.done / item.size * 100)) : 0;
    return <article className="item-card incoming" data-testid="incoming-card" aria-label={`${item.name} is arriving`}>
      <div className="incoming-head"><span className="incoming-icon"><Icon size={16} /></span><strong title={item.path}>{item.name}</strong><LoaderCircle size={14} className="spin" /></div>
      <small>Arriving{item.from ? ` from ${item.from}` : ''} · {item.done > 0 ? `${size(item.done)} of ${size(item.size)}` : item.size > 0 ? size(item.size) : 'waiting'}</small>
      <div className={`incoming-bar ${item.done > 0 ? '' : 'indeterminate'}`} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.max(2, percent)}%` }} /></div>
    </article>;
  }
  function renderCard(item: LibraryItem, dragOut = false) {
    const color = item.path.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0) % 3;
    const folder = folderOf(item.path);
    return <article className={`item-card ${item.kind} note-color-${color} ${note?.path === item.path ? 'open' : ''} ${selected.includes(item.path) ? 'selected' : ''}`} data-testid="item-card" data-path={item.path} draggable={dragOut || undefined} onDragStart={dragOut ? event => { event.preventDefault(); void window.syncit.dragOut(selected.includes(item.path) ? selected : item.path).catch(error => notify(String(error))); } : undefined}>
      {settings?.favorites?.includes(item.path) && <Star className="favorite-mark" size={14} fill="currentColor" aria-label="Favorite" />}
      <button className="card-main" onClick={event => { if (event.shiftKey && lastClicked.current) { const order = visible.map(entry => entry.path); const from = order.indexOf(lastClicked.current), to = order.indexOf(item.path); if (from >= 0 && to >= 0) { const range = order.slice(Math.min(from, to), Math.max(from, to) + 1); setSelected(current => [...new Set([...current, ...range])]); return; } } if (event.ctrlKey || event.metaKey || event.shiftKey) { lastClicked.current = item.path; setSelected(current => current.includes(item.path) ? current.filter(entry => entry !== item.path) : [...current, item.path]); return; } lastClicked.current = item.path; void run(() => openItem(item)); }} aria-label={`Open ${item.name}`}>
        {item.kind === 'image' ? <div className="image-preview"><Image size={32} className="image-fallback" /><img src={media(item)} alt={item.name} loading="lazy" draggable={false} onLoad={event => event.currentTarget.classList.add('loaded')} onError={event => { event.currentTarget.style.opacity = '0'; }} /></div> : item.kind === 'video' ? <div className="image-preview video-preview"><Film size={32} className="image-fallback" /><img src={media(item)} alt={item.name} loading="lazy" draggable={false} onLoad={event => event.currentTarget.classList.add('loaded')} onError={event => { event.currentTarget.style.opacity = '0'; }} /><span className="play-badge"><Play size={16} fill="currentColor" /></span></div> : item.kind === 'audio' ? <div className="file-preview"><div className="file-glyph audio-glyph"><Music size={37} strokeWidth={1.3} /><span>{item.name.split('.').at(-1)?.slice(0, 5).toUpperCase() || 'AUDIO'}</span></div><h3>{item.name}</h3><span>{size(item.size)}</span></div> : item.kind === 'note' ? <div className="note-preview"><h3>{title(item)}</h3><p>{notePreview(item)}</p></div> : <div className={`file-preview ${previewKind(item.name) === 'pdf' ? 'pdf-card' : ''}`}>{previewKind(item.name) === 'pdf' && <img className="pdf-thumb" src={media(item)} alt="" loading="lazy" draggable={false} onError={event => { event.currentTarget.style.display = 'none'; }} />}<div className="file-glyph"><File size={37} strokeWidth={1.3} /><span>{item.name.split('.').at(-1)?.slice(0, 5).toUpperCase() || 'FILE'}</span></div><h3>{item.name}</h3><span>{size(item.size)}</span></div>}
      </button>
      <footer><div>{(item.kind === 'image' || item.kind === 'video') && <strong>{item.name}</strong>}{folder && <span className="path-chip" title={folder}><Folder size={10} />{folder}</span>}<span>{item.conflict ? <><AlertTriangle size={12} /> Conflict copy</> : item.arrivedFrom ? <em className="arrived"><ArrowDownToLine size={12} /> from {item.arrivedFrom} · {since(item.modifiedAt)}</em> : since(item.modifiedAt)}{(item.kind === 'image' || item.kind === 'video') && ` · ${size(item.size)}`}</span></div><details className="card-menu"><summary aria-label={`Actions for ${item.name}`}><MoreHorizontal size={19} /></summary><div onClick={event => (event.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')}><button onClick={() => void run(() => openItem(item))}><ExternalLink size={14} />Open</button><button onClick={() => { setRename(item); setNewName(item.name); }}><Pencil size={14} />Rename</button><button onClick={() => { setMoving(selected.includes(item.path) ? selected : [item.path]); setMoveTarget(folderOf(item.path)); }}><Folder size={14} />Move to folder</button><button onClick={() => void run(() => window.syncit.reveal(item.path))}><FolderOpen size={14} />Show in folder</button><button onClick={() => void run(() => window.syncit.place({ version: 1, path: item.path, x: 40 + library.placements.length % 6 * 35, y: 40 + library.placements.length % 6 * 35, width: 280, height: 290, updatedAt: Date.now() }), 'Pinned to the board.')}><Pin size={14} />Pin to board</button><button onClick={() => void run(() => window.syncit.favorite(item.path, !settings?.favorites?.includes(item.path)))}><Star size={14} />{settings?.favorites?.includes(item.path) ? 'Remove favorite' : 'Add to favorites'}</button><button className="danger" onClick={() => setDeleting(selected.includes(item.path) ? library.items.filter(entry => selected.includes(entry.path)) : [item])}><Trash2 size={14} />Move to Trash</button></div></details></footer>
    </article>;
  }
  if (fatal) return <div className="fatal"><Brand /><h2>The collection could not be opened.</h2><p>{fatal}</p><button onClick={() => location.reload()}>Try again</button></div>;
  if (!initial || !settings || !sync) return <div className="loading"><Brand /><LoaderCircle className="spin" size={22} /><span>Opening the collection…</span></div>;
  const name = collectionName(settings.root);
  const query = search.toLowerCase();
  // Everything, unsearched, browses one level at a time: the files in the current folder and a card for each subfolder. Filters and search stay flat.
  const browsing = view === 'grid' && filter === 'all' && !search;
  const visible = library.items.filter(item => (browsing ? folderOf(item.path) === (folder || '') : !folder || item.path.startsWith(folder + '/')) && (filter === 'all' || (filter === 'favorite' ? settings.favorites?.includes(item.path) : filter === 'conflict' ? item.conflict : filter === 'arrived' ? !!item.arrivedFrom : item.kind === filter)) && `${item.path} ${item.preview || ''}`.toLowerCase().includes(query));
  const counts = { favorite: library.items.filter(item => settings.favorites?.includes(item.path)).length, note: library.items.filter(i => i.kind === 'note').length, image: library.items.filter(i => i.kind === 'image').length, video: library.items.filter(i => i.kind === 'video').length, audio: library.items.filter(i => i.kind === 'audio').length, file: library.items.filter(i => i.kind === 'file').length, conflict: library.items.filter(i => i.conflict).length, arrived: library.items.filter(i => i.arrivedFrom).length };
  const arriving = (filter === 'all' || filter === 'arrived') && !search ? sync.incoming.filter(item => !folder || item.path.startsWith(folder + '/')) : [];
  const receiving = sync.incoming.length ? `Receiving ${sync.incoming.length === 1 ? sync.incoming[0].name : `${sync.incoming.length} files`}${sync.inRate > 0 ? ` · ${size(sync.inRate)}/s` : ''}` : '';
  const connectedPeers = sync.peers.filter(peer => peer.connected).length;
  const peerSummary = sync.peers.length === 0 ? 'Not paired yet' : sync.peers.length === 1 ? sync.peers[0].name : `${sync.peers.length} computers · ${connectedPeers} online`;
  const peerDetail = sync.pending.length ? `${sync.pending.length} ${sync.pending.length === 1 ? 'request' : 'requests'} waiting` : sync.peers.length === 0 ? (sync.nearby.length ? `${sync.nearby.length} nearby · pair a computer` : 'Pair a computer') : receiving || labels[sync.state];
  visibleRef.current = visible; selectedRef.current = selected;
  const heading = view === 'board' ? 'Pinboard' : folder && filter === 'all' ? folder.split('/').pop()! : filterTitles[filter];
  const crumbs = browsing && folder ? folder.split('/') : [];
  const subfolders = browsing ? [...library.items.reduce((map, item) => { const prefix = folder ? folder + '/' : ''; if (!item.path.startsWith(prefix)) return map; const rest = item.path.slice(prefix.length); const cut = rest.indexOf('/'); if (cut <= 0) return map; const name = rest.slice(0, cut); const entry = map.get(name) || { name, path: prefix + name, count: 0, samples: [] as LibraryItem[] }; entry.count++; if (item.kind === 'image' && entry.samples.length < 3) entry.samples.push(item); map.set(name, entry); return map; }, new Map<string, { name: string; path: string; count: number; samples: LibraryItem[] }>()).values()].sort((a, b) => a.name.localeCompare(b.name)) : [];
  const folders = [...new Set(library.items.map(item => item.path.split('/')[0]).filter((part, _i, _a) => library.items.some(item => item.path.startsWith(part + '/'))))].sort((a, b) => a.localeCompare(b));
  const selectedItems = library.items.filter(item => selected.includes(item.path));
  const allFavorites = selectedItems.length > 0 && selectedItems.every(item => settings.favorites?.includes(item.path));
  const statusIcon = sync.state === 'synced' ? <CheckCheck size={17} /> : sync.state === 'offline' ? <WifiOff size={17} /> : sync.state === 'error' ? <AlertTriangle size={17} /> : sync.state === 'syncing' || sync.state === 'starting' ? <LoaderCircle size={17} className="spin" /> : <Link2 size={17} />;
  const captureHandlers = {
    onDragEnter: (event: React.DragEvent) => { if (internalDrag.current || event.dataTransfer.types.includes('application/x-syncit-item')) return; event.preventDefault(); dragDepth.current++; setDragging(true); },
    onDragLeave: (event: React.DragEvent) => { event.preventDefault(); if (--dragDepth.current <= 0) setDragging(false); },
    onDragOver: (event: React.DragEvent) => event.preventDefault(), onDrop: (event: React.DragEvent) => { void drop(event); },
    onPaste: (event: React.ClipboardEvent) => { if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]') || note || settingsTab) return; event.preventDefault(); void run(paste); }
  };
  const navButton = (target: Filter, _Icon: typeof FileText, label: string, count?: number) => <button key={target} className={`${view === 'grid' && filter === target ? 'active' : ''} ${target === 'conflict' ? 'attention' : ''}`} onClick={() => { setView('grid'); setFilter(target); setFolder(null); }}>{label}{count !== undefined && <span>{count}</span>}</button>;
  return <div className={isPanel ? 'quick-app' : 'app-shell'} inert={preparingUpdate || undefined} {...captureHandlers}>
    {preparingUpdate && <div className="modal-shade" style={{ zIndex: 2000 }}><section className="small-dialog"><h2>Preparing the update…</h2><p>Saving notes and stopping sync.</p></section></div>}
    {!isPanel && update && ['available', 'ready'].includes(update.phase) && <button className="update-notice" onClick={() => setSettingsTab('preferences')}>Update {update.availableVersion} {update.phase === 'ready' ? 'ready to install' : 'available'} <ArrowRight size={13} /></button>}
    {isPanel ? <QuickPanel settings={settings} items={library.items} incoming={sync.incoming} status={receiving || labels[sync.state]} platform={initial.platform} open={item => void run(() => openItem(item))} paste={paste} notify={notify} pile={pile} expand={() => { setPile(false); void window.syncit.showPanel(); }} media={media} /> : <>
      <aside className="rail">
        <button className="rail-head" title={settings.root} onClick={() => setSettingsTab('preferences')}><strong>{name}</strong><small>{settings.deviceName}{sync.peers.length > 0 && ` · ${peerSummary}`}</small></button>
        <nav aria-label="Collection">{navButton('all', LayoutGrid, 'Everything', library.items.length)}{navButton('note', FileText, 'Notes', counts.note)}{navButton('image', Image, 'Images', counts.image)}{counts.video > 0 && navButton('video', Film, 'Videos', counts.video)}{counts.audio > 0 && navButton('audio', Music, 'Audio', counts.audio)}{navButton('file', File, 'Files', counts.file)}{(counts.arrived > 0 || sync.incoming.length > 0) && navButton('arrived', ArrowDownToLine, 'From other computers', counts.arrived + sync.incoming.length)}{counts.conflict > 0 && navButton('conflict', AlertTriangle, 'Conflicts', counts.conflict)}
          {folders.length > 0 && <><div className="nav-gap" /><small className="nav-label">Folders</small>{folders.slice(0, 12).map(name => <button key={name} className={view === 'grid' && folder === name ? 'active' : ''} onClick={() => { setView('grid'); setFilter('all'); setFolder(name); }}>{name}<span>{library.items.filter(item => item.path.startsWith(name + '/')).length}</span></button>)}</>}
          <div className="nav-gap" /><button className={view === 'board' ? 'active' : ''} onClick={() => { setView('board'); setFilter('all'); setSearch(''); setFolder(null); }}>Pinboard<span>{library.placements.length}</span></button>{navButton('favorite', Star, 'Favorites', counts.favorite)}</nav>
        <div className="rail-foot">
          <button className="rail-sync" title={peerDetail} onClick={() => setSettingsTab('connect')}><span className={`status-dot ${sync.state === 'synced' ? 'green' : sync.state === 'error' ? 'red' : ''}`} />{sync.peers.length === 0 ? 'Not paired yet' : sync.pending.length ? peerDetail : receiving || labels[sync.state]}{sync.pending.length > 0 && <b>{sync.pending.length}</b>}</button>
          {sync.peers.length === 0 && <button onClick={() => setSettingsTab('connect')}>Pair a computer</button>}
          <button onClick={() => setSettingsTab('preferences')}>Preferences</button>
        </div>
      </aside>
      <main className="main-content"><header className="topbar"><div className="search-box"><Search size={16} /><input aria-label="Search the collection" placeholder="Search names, folders and note text" value={search} onChange={event => setSearch(event.target.value)} />{search ? <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button> : <kbd>{initial.platform === 'darwin' ? '⌘' : 'Ctrl'} K</kbd>}</div><div className="topbar-actions">{(sync.state === 'error' || sync.pending.length > 0) && <button className={`sync-pill ${sync.state}`} onClick={() => setSettingsTab('connect')}>{statusIcon}<span>{sync.pending.length > 0 ? 'Pairing request' : 'Needs attention'}</span>{sync.pending.length > 0 && <b>{sync.pending.length}</b>}</button>}<div className="view-switch"><button aria-label="Grid view" title="Grid" className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}><LayoutGrid size={18} /></button><button aria-label="Pinboard view" title="Pinboard" className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}><Pin size={18} /></button></div><button className="icon-button" aria-label="Open command palette" title="Commands · Ctrl/⌘ K" onClick={() => setPalette(true)}><Command size={18} /></button><button title="Open Quick drop" aria-label="Open Quick drop" className="icon-button" onClick={() => void window.syncit.showPanel()}><PanelTop size={19} /></button><details className="card-menu add-menu"><summary aria-label="Add to the collection" title="Add files, a folder or the clipboard"><FolderPlus size={16} />Add</summary><div><button disabled={busy} onClick={() => void choose('files')}><File size={14} />Files…</button><button disabled={busy} onClick={() => void choose('folder')}><Folder size={14} />Folder…</button><button disabled={busy} onClick={() => { document.querySelector('details.add-menu')?.removeAttribute('open'); void run(paste); }}><Clipboard size={14} />Paste from clipboard</button></div></details><button className="primary new-note" disabled={busy} onClick={() => void run(async () => setNote(await window.syncit.createNote()))}><Plus size={16} />New note</button></div></header>
        {library.error && <div className="page-error"><AlertTriangle size={18} /><span>{library.error}</span><button onClick={() => void refresh()}>Retry</button></div>}
        {sync.pending.length > 0 && <button className="pair-banner" onClick={() => setSettingsTab('connect')}><Link2 size={18} />{sync.pending[0].name} asks to join this collection.<span>Review request <ArrowRight size={15} /></span></button>}
        {view === 'board' ? <Board items={visible} placements={library.placements} renderCard={renderCard} notify={notify} /> : <div className="collection-scroll"><div className="collection-caption">{crumbs.length > 0 && <nav className="crumbs" aria-label="Folder path"><button aria-label="Back to Everything" onClick={() => { setFolder(null); setSelected([]); }}>Everything</button>{crumbs.slice(0, -1).map((segment, index) => <span key={index}><span className="crumb-sep">/</span><button onClick={() => { setFolder(crumbs.slice(0, index + 1).join('/')); setSelected([]); }}>{segment}</button></span>)}<span className="crumb-sep">/</span></nav>}<h1>{search ? 'Results' : heading}</h1><b>· {subfolders.length > 0 && `${subfolders.length} ${subfolders.length === 1 ? 'folder' : 'folders'} · `}{visible.length} {visible.length === 1 ? 'item' : 'items'}</b>{selected.length > 0 && <div className="selection-bar" role="toolbar" aria-label="Selection"><b>{selected.length} selected</b><button onClick={() => void run(async () => { for (const item of selectedItems) await window.syncit.favorite(item.path, !allFavorites); }, allFavorites ? 'Removed from favorites.' : 'Added to favorites.')}><Star size={13} />{allFavorites ? 'Remove favorites' : 'Favorite'}</button><button onClick={() => { setMoving(selected); setMoveTarget(''); }}><Folder size={13} />Move to folder</button><button className="danger" onClick={() => setDeleting(selectedItems)}><Trash2 size={13} />Move to Trash</button><button onClick={() => setSelected([])} aria-label="Clear selection"><X size={13} />Clear</button><small>Drag any selected card to drag them all out.</small></div>}<div className="caption-right"><span>Latest first{library.items.length ? ` · ${size(library.items.reduce((sum, item) => sum + item.size, 0))} on this computer` : ''}</span></div></div>
          {visible.length || arriving.length || subfolders.length ? <div className="card-grid">{subfolders.map(entry => <div key={'folder:' + entry.path}><button className="item-card folder-card" data-testid="folder-card" aria-label={`Open folder ${entry.name}`} title={entry.path} onClick={() => { setFolder(entry.path); setSelected([]); }}>{entry.samples.length > 0 && <div className="folder-thumbs">{entry.samples.map(sample => <img key={sample.path} src={media(sample)} alt="" loading="lazy" draggable={false} onLoad={event => event.currentTarget.classList.add('loaded')} />)}</div>}<div className="folder-row"><span className="folder-icon"><Folder size={15} /></span><strong>{entry.name}</strong><small>{entry.count} {entry.count === 1 ? 'item' : 'items'}</small></div></button></div>)}{arriving.map(item => <div key={'incoming:' + item.path}>{renderIncoming(item)}</div>)}{visible.map(item => <div key={item.path}>{renderCard(item, true)}</div>)}</div> : search || filter !== 'all' ? <div className="empty-results">{filter === 'favorite' && !search ? <Star size={28} /> : <Search size={28} />}<h3>{search ? 'No matches.' : filter === 'favorite' ? 'No favorites yet.' : filter === 'arrived' ? 'Nothing has arrived from other computers in the last two days.' : `No ${filterTitles[filter].toLowerCase()} yet.`}</h3><p>{search ? 'Search covers file names, folder names and the first 32,000 characters of each note.' : filter === 'favorite' ? 'Star an item from its card menu to keep it one click away here and in Quick drop. Favorites stay on this computer.' : 'Items you add appear here.'}</p></div> : <div className="welcome-empty"><h2>Nothing here yet.</h2><p>Write a note, paste, or drop files anywhere in this window. Everything in the collection folder reaches the computers you pair.</p><div className="row"><button className="primary" onClick={() => void run(async () => setNote(await window.syncit.createNote()))}><Plus size={16} />Write a note</button><button onClick={() => void run(paste)}><Clipboard size={16} />Paste</button><button onClick={() => void choose('files')}>Choose files</button><button onClick={() => void choose('folder')}>Choose a folder <ArrowRight size={15} /></button></div></div>}
        </div>}
      </main>
    </>}
    {palette && <CommandPalette items={library.items} open={item => void run(() => openItem(item))} close={() => setPalette(false)} commands={[
      { label: 'New note', hint: 'Capture', run: () => void run(async () => setNote(await window.syncit.createNote())) },
      { label: 'Add files…', hint: 'Capture', run: () => void choose('files') },
      { label: 'Add a folder…', hint: 'Capture', run: () => void choose('folder') },
      { label: 'Paste from clipboard', hint: 'Capture', run: () => void run(paste) },
      { label: 'Open minimal capture window', hint: 'Window', run: () => void run(async () => { await window.syncit.settings({ panelMode: 'mini' }); await window.syncit.showPanel(); }) },
      { label: 'Open Quick drop', hint: 'Window', run: () => void run(async () => { await window.syncit.settings({ panelMode: 'quick' }); await window.syncit.showPanel(); }) },
      { label: 'Open the drawer', hint: 'Window', run: () => void run(() => window.syncit.openDrawer()) },
      { label: 'Show favorites', hint: 'Collection', run: () => { setFilter('favorite'); setView('grid'); } },
      { label: 'Open pinboard', hint: 'Collection', run: () => { setView('board'); setFilter('all'); } },
      { label: 'Open collection folder', hint: 'Folder', run: () => void run(() => window.syncit.openFolder()) },
      { label: sync.state === 'paused' ? 'Resume sync' : 'Pause sync', hint: 'Sync', run: () => void run(() => window.syncit.settings({ syncPaused: sync.state !== 'paused' })) },
      { label: 'Computers & sync', hint: 'Preferences', run: () => setSettingsTab('connect') },
      { label: 'General preferences', hint: 'Preferences', run: () => setSettingsTab('preferences') }
    ]} />}
    {dragging && <div className="drop-overlay"><div><ArrowDownToLine size={40} /><h2>Drop to add</h2><p>Files are copied into the collection.</p></div></div>}
    {toast && <div className="toast" role="status"><span>{toast}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setToast('')}><X size={15} /></button></div>}
    {note && <NoteEditor key={note.path} mode={isPanel ? 'overlay' : 'pane'} document={note} close={() => setNote(null)} notify={notify} runId={initial.runId} root={settings.root} />}
    {settingsTab && <SettingsPanel settings={settings} sync={sync} close={() => setSettingsTab(null)} update={setSettings} notify={notify} initialTab={settingsTab} />}
    {preview && <div className="modal-shade" onClick={event => { if (event.target === event.currentTarget) setPreview(null); }}><section className={`image-modal media-modal ${previewKind(preview.name) || 'file'}`} role="dialog" aria-label={previewLabel(preview)}><header><strong>{preview.name}</strong><button className="icon-button" aria-label="Close preview" onClick={() => setPreview(null)}><X size={21} /></button></header>
      <PreviewBody item={preview} onFail={() => setMediaError(true)} />
      {mediaError && <p className="inline-warning media-error"><AlertTriangle size={16} /> This computer cannot show this file inside Satchel. Open it in its default app instead.</p>}
      <footer><span>{size(preview.size)}{folderOf(preview.path) && ` · ${folderOf(preview.path)}`}</span><div className="row"><button onClick={() => void run(() => window.syncit.reveal(preview.path))}><FolderOpen size={15} />Show in folder</button><button onClick={() => void run(() => window.syncit.open(preview.path))}><ExternalLink size={15} />Open original</button></div></footer></section></div>}
    {rename && <div className="modal-shade"><form className="small-dialog" onSubmit={event => { event.preventDefault(); void run(async () => { await window.syncit.rename(rename.path, newName); setRename(null); }); }}><h2>Rename item</h2><label>Filename<input aria-label="Filename" autoFocus value={newName} onChange={event => setNewName(event.target.value)} /></label><div className="row"><button type="button" onClick={() => setRename(null)}>Cancel</button><button disabled={busy} className="primary">Rename</button></div></form></div>}
    {deleting && <div className="modal-shade"><section className="small-dialog" role="dialog" aria-label="Delete item"><Trash2 size={25} /><h2>Move to Trash?</h2><p>{deleting.length === 1 ? `“${deleting[0].name}”` : `${deleting.length} items`} will also be removed from paired computers when they reconnect. The local {deleting.length === 1 ? 'copy' : 'copies'} can be recovered from the Trash or Recycle Bin.</p><div className="row"><button onClick={() => setDeleting(null)}>Keep {deleting.length === 1 ? 'it' : 'them'}</button><button className="danger-button" disabled={busy} onClick={() => void run(async () => { for (const item of deleting) await window.syncit.trash(item.path); setDeleting(null); setSelected([]); }, 'Moved to Trash.')}>Move to Trash</button></div></section></div>}
    {moving && <div className="modal-shade"><form className="small-dialog move-dialog" role="dialog" aria-label="Move to folder" onSubmit={event => { event.preventDefault(); void run(async () => { await window.syncit.move(moving, moveTarget.trim()); setMoving(null); setSelected([]); }, moveTarget.trim() ? `Moved to ${moveTarget.trim()}.` : 'Moved to the top of the collection.'); }}><h2>Move {moving.length === 1 ? 'to folder' : `${moving.length} items to folder`}</h2><div className="folder-choices"><button type="button" className={moveTarget === '' ? 'active' : ''} onClick={() => setMoveTarget('')}>Top of the collection</button>{folders.map(name => <button type="button" key={name} className={moveTarget === name ? 'active' : ''} onClick={() => setMoveTarget(name)}><Folder size={13} />{name}</button>)}</div><label>Folder name<input aria-label="Folder name" autoFocus value={moveTarget} onChange={event => setMoveTarget(event.target.value)} placeholder="New or existing folder" /></label><p>Folders are ordinary folders inside the collection; paired computers get the same layout.</p><div className="row"><button type="button" onClick={() => setMoving(null)}>Cancel</button><button className="primary" disabled={busy}>Move</button></div></form></div>}
    {!settings.onboardingDone && !isPanel && <div className="modal-shade onboarding-shade"><section className="onboarding" role="dialog" aria-label="Set up the collection"><Brand /><h1>Set up your collection</h1><p>Satchel keeps files, screenshots and notes in one folder on this computer, and syncs that folder directly with the computers you pair on your local network.</p>
      <div className="onboarding-folder"><span className="eyebrow">Collection folder</span><code>{settings.root}</code><button type="button" disabled={busy} onClick={() => void run(async () => { const next = await window.syncit.chooseRoot(); if (next) setSettings(next); })}>Choose a different folder</button></div>
      <label className="toggle-row"><div><strong>Start Satchel at login</strong><small>Keeps syncing from the tray or menu bar.</small></div><input type="checkbox" checked={loginChoice} onChange={event => setLoginChoice(event.target.checked)} /></label>
      <label className="toggle-row"><div><strong>Desktop shortcut to the collection folder</strong><small>Use Explorer or Finder on the same files.</small></div><input type="checkbox" checked={shortcutChoice} onChange={event => setShortcutChoice(event.target.checked)} /></label>
      <button className="primary" disabled={busy} onClick={() => void run(async () => { const next = await window.syncit.settings({ onboardingDone: true, startAtLogin: loginChoice }); setSettings(next); if (shortcutChoice) await window.syncit.shortcut(); }, 'Collection ready. Pair another computer under Computers & sync.')}>Create collection <ArrowRight size={17} /></button>
      <small>A thin handle at the right edge of the screen is the drawer: drag files to it from anywhere. Pair other computers afterwards from the sidebar. Nothing is sent outside your local network.</small></section></div>}
  </div>;
}
