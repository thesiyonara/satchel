import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpRight, Blend, Clipboard, ClipboardCopy, Expand, FileText, Film, Image, File, LayoutGrid, List, LoaderCircle, Minimize2, Music, Paperclip, Pin, Plus, X } from 'lucide-react';
import type { IncomingItem, LibraryItem, Pasteboard as PasteboardState, Settings } from '../shared/types';
import { mediaKind } from '../shared/media';
import { formatSize as size } from '../shared/format';
import { Mark } from './Mark';
import { liveStatus, useLiveText } from './Pasteboard';

const icons = { note: FileText, image: Image, video: Film, audio: Music, file: File };
const VIEW_KEY = 'quickDropView';
/** A short type label for a file without a picture: its extension, up to four letters. */
function glyph(name: string) { const dot = name.lastIndexOf('.'); return dot > 0 && name.length - dot <= 6 ? name.slice(dot + 1).toUpperCase() : 'FILE'; }

/**
 * Quick drop: the small window for going back and forth between computers. The live pasteboard on top, with Paste and Add files in its corner,
 * and under it Latest: what is arriving, what came in from the other computers and what went out from here, as tiles or a list, with Copy and
 * Open on hover and every tile or row dragging out. The minimal window keeps the note composer, and the drawer keeps its pile.
 */
export function QuickPanel({ settings, items, incoming, status, platform, open, paste, notify, pile, expand, media, board, peer, since }: { settings: Settings; items: LibraryItem[]; incoming: IncomingItem[]; status: string; platform: string; open: (item: LibraryItem) => void; paste: () => Promise<void>; notify: (message: string) => void; pile: boolean; expand: () => void; media: (item: LibraryItem) => string; board?: PasteboardState; peer?: string; since: (time: number) => string }) {
  const mini = settings.panelMode === 'mini';
  const key = 'quick-capture:' + settings.root;
  const [text, setText] = useState(() => localStorage.getItem(key) || '');
  const [busy, setBusy] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [opacityOpen, setOpacityOpen] = useState(false);
  const [opacity, setOpacity] = useState(Math.round((settings.panelOpacity ?? 1) * 100));
  const [view, setView] = useState<'tiles' | 'list'>(() => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'tiles'; } catch { return 'tiles'; } });
  const opacityTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useLiveText(board, notify);
  useEffect(() => { setOpacity(Math.round((settings.panelOpacity ?? 1) * 100)); }, [settings.panelOpacity]);
  function changeOpacity(value: number) {
    setOpacity(value);
    clearTimeout(opacityTimer.current); opacityTimer.current = setTimeout(() => { void window.syncit.settings({ panelOpacity: value / 100 }).catch(error => notify(String(error))); }, 150);
  }
  useEffect(() => { const listener = (event: StorageEvent) => { if (event.key === key) setText(event.newValue || ''); }; window.addEventListener('storage', listener); return () => window.removeEventListener('storage', listener); }, [key]);
  async function perform(action: () => Promise<unknown>) { setBusy(true); try { await action(); } catch (error) { notify(String(error)); } finally { setBusy(false); } }
  async function save() {
    if (!text.trim() || busy) return;
    const value = text;
    await perform(async () => {
      await window.syncit.createNote(value);
      setText(current => { if (current !== value) return current; localStorage.removeItem(key); return ''; });
      setCaptured(true);
    });
  }
  const switchView = (next: 'tiles' | 'list') => { setView(next); try { localStorage.setItem(VIEW_KEY, next); } catch { /* per-computer convenience only */ } };
  // Copy puts a note's text or an image on the clipboard; other files are dragged or opened.
  const copy = async (item: LibraryItem) => {
    try {
      if (item.kind === 'note') await navigator.clipboard.writeText(await window.syncit.readText(item.path));
      else if (item.kind === 'image') { const blob = await (await fetch(media(item).replace('/thumbnail', '/preview'))).blob(); await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]); }
      else return;
      notify(`${item.name} copied.`);
    } catch (error) { notify(`Could not copy: ${String(error)}`); }
  };
  const drag = (item: LibraryItem) => (event: React.DragEvent) => { event.preventDefault(); void window.syncit.dragOut(item.path).catch(error => notify(String(error))); };
  const latest = items.slice(0, view === 'tiles' ? 6 : 5);
  const arriving = incoming.slice(0, view === 'tiles' ? 3 : 2);
  const origin = (item: LibraryItem) => item.arrivedFrom ? `from ${item.arrivedFrom}` : peer ? 'from here' : '';
  const modifier = platform === 'darwin' ? '⌘' : 'Ctrl';
  const actions = (item: LibraryItem) => <span className="qd-acts">{(item.kind === 'note' || item.kind === 'image') && <button aria-label={`Copy ${item.name}`} title="Copy" onClick={event => { event.stopPropagation(); void copy(item); }}><ClipboardCopy size={13} /></button>}<button aria-label={`Open ${item.name}`} title="Open" onClick={event => { event.stopPropagation(); open(item); }}><ArrowUpRight size={13} /></button></span>;
  return <section className={`floating-workspace ${mini ? 'is-mini' : ''}`}>
    <header className="floating-titlebar"><span className="floating-wordmark"><Mark size={16} />{pile ? 'Satchel' : 'Quick drop'}</span>{pile ? <span className="floating-mode">Drawer</span> : mini ? <span className="floating-mode">Capture</span> : <span className="floating-mode qd-peer" title={status}><i className={`status-dot ${peer ? 'green' : ''}`} /><span>{peer || status}</span></span>}<div>
      {pile && <button aria-label="Open Quick drop" title="Open the full Quick drop window" onClick={expand}><Expand size={14} /></button>}{!pile && <><button aria-label="Window opacity" aria-pressed={opacityOpen} title={`Window · opacity ${opacity}%`} onClick={() => setOpacityOpen(value => !value)}><Blend size={14} /></button>
      <button aria-label="Keep floating window on top" aria-pressed={settings.alwaysOnTop} title="Keep on top" onClick={() => void perform(() => window.syncit.settings({ alwaysOnTop: !settings.alwaysOnTop }))}><Pin size={14} /></button>
      <button aria-label={mini ? 'Expand floating window' : 'Minimal floating window'} title={mini ? 'Full window' : 'Minimal window'} onClick={() => void perform(() => window.syncit.settings({ panelMode: mini ? 'quick' : 'mini' }))}>{mini ? <Expand size={14} /> : <Minimize2 size={14} />}</button>
      {!mini && <button aria-label="Open dashboard" title="Open the main window" onClick={() => void window.syncit.showDashboard()}><ArrowUpRight size={15} /></button>}</>}
      <button aria-label="Hide floating window" title="Hide" onClick={() => void window.syncit.panel('hide')}><X size={15} /></button>
    </div></header>
    {opacityOpen && <div className="floating-opacity"><Blend size={13} /><input type="range" min="60" max="100" step="5" aria-label="Floating window opacity" value={opacity} onChange={event => changeOpacity(Number(event.target.value))} /><span>{opacity}%</span><button title="Dock to the left edge" aria-label="Dock left" onClick={() => void window.syncit.panel('left')}><ArrowLeftToLine size={14} /></button><button title="Dock to the right edge" aria-label="Dock right" onClick={() => void window.syncit.panel('right')}><ArrowRightToLine size={14} /></button></div>}
    {pile ? <Pile items={items} incoming={incoming} open={open} media={media} expand={expand} paste={() => perform(paste)} busy={busy} /> : mini ? <>
    <form className="capture-composer" onSubmit={event => { event.preventDefault(); void save(); }}>
      <textarea aria-label="Quick capture text" placeholder="Write a note…" value={text} onChange={event => { setText(event.target.value); try { localStorage.setItem(key, event.target.value); } catch { notify('Draft storage is full. Capture this text before closing.'); } }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save(); } }} />
      <div><span>{captured && !text ? 'Saved to the collection' : `${modifier} + Enter to capture`}</span><button className="capture-submit" aria-label="Save quick capture" disabled={busy || !text.trim()}><Plus size={14} />Capture</button></div>
    </form>
    <div className="floating-tools"><button disabled={busy} aria-label="Paste from clipboard" onClick={() => void perform(paste)}><Clipboard size={14} />Paste</button><span /><button aria-label="Open dashboard" title="Open the main window" onClick={() => void window.syncit.showDashboard()}>Dashboard<ArrowUpRight size={14} /></button></div>
    </> : <>
    <div className="qd-board">
      <textarea aria-label="Pasteboard text" placeholder="Pasteboard" value={live.text} onChange={event => live.change(event.target.value)} spellCheck={false} />
      <div className="qd-board-bar"><span>Pasteboard · live · {liveStatus(live.state, board, since).replace(/^./, first => first.toLowerCase())}</span><button aria-label="Copy pasteboard" title="Copy" disabled={!live.text} onClick={() => void navigator.clipboard.writeText(live.text).then(() => notify('Pasteboard copied.'), () => notify('The clipboard is unavailable.'))}><ClipboardCopy size={14} /></button><button disabled={busy} aria-label="Paste from clipboard" title="Paste from clipboard into the collection" onClick={() => void perform(paste)}><Clipboard size={14} /></button><button disabled={busy} aria-label="Add files" title="Add files" onClick={() => void perform(() => window.syncit.chooseFiles())}><Paperclip size={14} /></button></div>
    </div>
    <div className="qd-head"><h2>Latest</h2><span className="qd-switch"><button className={view === 'tiles' ? 'on' : ''} aria-label="Tiles" aria-pressed={view === 'tiles'} title="Tiles" onClick={() => switchView('tiles')}><LayoutGrid size={13} /></button><button className={view === 'list' ? 'on' : ''} aria-label="List" aria-pressed={view === 'list'} title="List" onClick={() => switchView('list')}><List size={13} /></button></span><button className="qd-all" onClick={() => void window.syncit.showDashboard()}>All</button></div>
    {view === 'tiles' ? <div className="qd-tiles">
      {arriving.map(item => { const Icon = icons[mediaKind(item.name) || (/\.(md|txt)$/i.test(item.name) ? 'note' : 'file')]; const percent = item.size > 0 ? Math.min(100, Math.round(item.done / item.size * 100)) : 0; return <div key={'incoming:' + item.path} className="qd-tile arriving" title={`${item.name} · arriving${item.from ? ` from ${item.from}` : ''} · ${size(item.size)}`}><span className="qd-sq"><Icon size={18} /><i className="qd-mark in"><ArrowDown size={9} /></i><em>{item.done > 0 ? `${percent}%` : ''}</em><span className={`qd-prog ${item.done > 0 ? '' : 'indeterminate'}`}><b style={{ width: `${Math.max(2, percent)}%` }} /></span></span><span className="qd-name">{item.name}</span><small>arriving{item.from ? ` · ${item.from}` : ''}</small></div>; })}
      {latest.map(item => { const Icon = icons[item.kind]; return <div key={item.path} className="qd-tile" title={item.name} draggable onDragStart={drag(item)} onDoubleClick={() => open(item)}>
        <span className={`qd-sq ${item.kind}`}>{item.kind === 'image' || item.kind === 'video' ? <><Icon size={18} /><img src={media(item)} alt="" loading="lazy" draggable={false} onLoad={event => event.currentTarget.classList.add('loaded')} /></> : item.kind === 'note' ? <span className="qd-text">{item.preview || item.name}</span> : <span className="qd-glyph">{glyph(item.name)}</span>}{item.arrivedFrom && <i className="qd-mark in"><ArrowDown size={9} /></i>}{actions(item)}</span>
        <span className="qd-name">{item.name}</span><small>{since(item.modifiedAt)}{origin(item) ? ` · ${origin(item)}` : ''}</small>
      </div>; })}
      {!latest.length && !arriving.length && <p className="qd-empty">Nothing in the collection yet.</p>}
    </div> : <div className="qd-list">
      {arriving.map(item => { const Icon = icons[mediaKind(item.name) || (/\.(md|txt)$/i.test(item.name) ? 'note' : 'file')]; const percent = item.size > 0 ? Math.min(100, Math.round(item.done / item.size * 100)) : 0; return <div key={'incoming:' + item.path} className="qd-row arriving" title={item.path}><span className="qd-icon in"><Icon size={15} /></span><span className="qd-row-name"><strong>{item.name}</strong><small>arriving{item.from ? ` from ${item.from}` : ''} · {item.done > 0 ? `${percent}%` : size(item.size)}</small><span className={`qd-prog ${item.done > 0 ? '' : 'indeterminate'}`}><b style={{ width: `${Math.max(2, percent)}%` }} /></span></span><LoaderCircle size={13} className="spin" /></div>; })}
      {latest.map(item => { const Icon = icons[item.kind]; return <div key={item.path} className="qd-row" draggable onDragStart={drag(item)} onDoubleClick={() => open(item)}><span className={`qd-icon ${item.arrivedFrom ? 'in' : ''}`}><Icon size={15} /></span><span className="qd-row-name"><strong>{item.name}</strong><small>{since(item.modifiedAt)}{origin(item) ? ` · ${origin(item)}` : ''}</small></span>{actions(item)}</div>; })}
      {!latest.length && !arriving.length && <p className="qd-empty">Nothing in the collection yet.</p>}
    </div>}
    </>}
  </section>;
}

// The drawer's pile: a place to drop, and the last few things in the satchel, with where they came from.
function Pile({ items, incoming, open, media, expand, paste, busy }: { items: LibraryItem[]; incoming: IncomingItem[]; open: (item: LibraryItem) => void; media: (item: LibraryItem) => string; expand: () => void; paste: () => Promise<void>; busy: boolean }) {
  const recent = items.slice(0, 12);
  const arriving = incoming.slice(0, 4);
  return <div className="pile">
    <div className="pile-drop"><ArrowDownToLine size={20} /><h2>Drop here</h2><p>Files, text or a screenshot. It goes in the satchel on every computer.</p><div className="pile-actions"><button disabled={busy} aria-label="Paste from clipboard" onClick={() => void paste()}><Clipboard size={14} />Paste</button><button onClick={expand}><FileText size={14} />Write a note</button></div></div>
    <div className="pile-items">{arriving.map(item => { const Icon = icons[mediaKind(item.name) || (/\.(md|txt)$/i.test(item.name) ? 'note' : 'file')]; const percent = item.size > 0 ? Math.min(100, Math.round(item.done / item.size * 100)) : 0; return <div key={'incoming:' + item.path} className="pile-incoming" title={item.path}><div><span className="pile-icon"><Icon size={15} /></span><span className="pile-name">{item.name}</span><em>{item.done > 0 ? `${percent}%` : 'arriving'}{item.from ? ` · ${item.from}` : ''}</em><LoaderCircle size={13} className="spin" /></div><div className={`incoming-bar ${item.done > 0 ? '' : 'indeterminate'}`}><span style={{ width: `${Math.max(2, percent)}%` }} /></div></div>; })}{recent.map(item => { const Icon = icons[item.kind]; return <button key={item.path} onClick={() => open(item)} title={item.name} draggable onDragStart={event => { event.preventDefault(); void window.syncit.dragOut(item.path).catch(() => {}); }}>{item.kind === 'image' || item.kind === 'video' ? <img src={media(item)} alt="" loading="lazy" onLoad={event => event.currentTarget.classList.add('loaded')} /> : <span className="pile-icon"><Icon size={15} /></span>}<span className="pile-name">{item.kind === 'note' ? item.name.replace(/\.(md|txt)$/i, '') : item.name}</span>{item.arrivedFrom && <em>from {item.arrivedFrom}</em>}</button>; })}{!recent.length && <p>Nothing in the collection yet.</p>}</div>
    <button className="pile-expand" onClick={expand}>Open the full window<ArrowUpRight size={13} /></button>
  </div>;
}
