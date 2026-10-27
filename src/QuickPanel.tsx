import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpRight, Blend, Clipboard, Expand, FileText, Film, Image, File, Minimize2, Music, Pin, Plus, Star, X } from 'lucide-react';
import type { LibraryItem, Settings } from '../shared/types';
import { Mark } from './Mark';

const icons = { note: FileText, image: Image, video: Film, audio: Music, file: File };
export function QuickPanel({ settings, items, status, platform, open, paste, notify, pile, expand, media }: { settings: Settings; items: LibraryItem[]; status: string; platform: string; open: (item: LibraryItem) => void; paste: () => Promise<void>; notify: (message: string) => void; pile: boolean; expand: () => void; media: (item: LibraryItem) => string }) {
  const mini = settings.panelMode === 'mini';
  const key = 'quick-capture:' + settings.root;
  const [text, setText] = useState(() => localStorage.getItem(key) || '');
  const [busy, setBusy] = useState(false);
  const [favorites, setFavorites] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [opacityOpen, setOpacityOpen] = useState(false);
  const [opacity, setOpacity] = useState(Math.round((settings.panelOpacity ?? 1) * 100));
  const opacityTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
  const recent = items.filter(item => !favorites || settings.favorites?.includes(item.path)).slice(0, 5);
  const modifier = platform === 'darwin' ? '⌘' : 'Ctrl';
  return <section className={`floating-workspace ${mini ? 'is-mini' : ''}`}>
    <header className="floating-titlebar"><span className="floating-wordmark"><Mark size={16} />Satchel</span><span className="floating-mode">{pile ? 'Drawer' : mini ? 'Capture' : 'Quick drop'}</span><div>
      {pile && <button aria-label="Open Quick drop" title="Open the full Quick drop window" onClick={expand}><Expand size={14} /></button>}{!pile && <><button aria-label="Window opacity" aria-pressed={opacityOpen} title={`Opacity ${opacity}%`} onClick={() => setOpacityOpen(value => !value)}><Blend size={14} /></button>
      <button aria-label="Keep floating window on top" aria-pressed={settings.alwaysOnTop} onClick={() => void perform(() => window.syncit.settings({ alwaysOnTop: !settings.alwaysOnTop }))}><Pin size={14} /></button>
      <button aria-label={mini ? 'Expand floating window' : 'Minimal floating window'} onClick={() => void perform(() => window.syncit.settings({ panelMode: mini ? 'quick' : 'mini' }))}>{mini ? <Expand size={14} /> : <Minimize2 size={14} />}</button></>}
      <button aria-label="Hide floating window" onClick={() => void window.syncit.panel('hide')}><X size={15} /></button>
    </div></header>
    {opacityOpen && <div className="floating-opacity"><Blend size={13} /><input type="range" min="60" max="100" step="5" aria-label="Floating window opacity" value={opacity} onChange={event => changeOpacity(Number(event.target.value))} /><span>{opacity}%</span></div>}
    {pile ? <Pile items={items} open={open} media={media} expand={expand} paste={() => perform(paste)} busy={busy} /> : <>{!mini && <div className="floating-intro"><h2>Add to the collection</h2><p>Write, paste or drop. Everything lands in the collection and on paired computers.</p></div>}
    <form className="capture-composer" onSubmit={event => { event.preventDefault(); void save(); }}>
      <textarea aria-label="Quick capture text" placeholder="Write a note…" value={text} onChange={event => { setText(event.target.value); try { localStorage.setItem(key, event.target.value); } catch { notify('Draft storage is full. Capture this text before closing.'); } }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save(); } }} />
      <div><span>{captured && !text ? 'Saved to the collection' : `${modifier} + Enter to capture`}</span><button className="capture-submit" aria-label="Save quick capture" disabled={busy || !text.trim()}><Plus size={14} />Capture</button></div>
    </form>
    <div className="floating-tools"><button disabled={busy} aria-label="Paste from clipboard" onClick={() => void perform(paste)}><Clipboard size={14} />Paste</button>{!mini && <button disabled={busy} onClick={() => void perform(() => window.syncit.chooseFiles())}>Add files</button>}<span /><button title="Dock to the left edge" aria-label="Dock left" onClick={() => void window.syncit.panel('left')}><ArrowLeftToLine size={15} /></button><button title="Dock to the right edge" aria-label="Dock right" onClick={() => void window.syncit.panel('right')}><ArrowRightToLine size={15} /></button><button aria-label="Open dashboard" title="Open the main window" onClick={() => void window.syncit.showDashboard()}>Dashboard<ArrowUpRight size={14} /></button></div>
    {!mini && <><div className="floating-tabs"><button className={!favorites ? 'active' : ''} onClick={() => setFavorites(false)}>Recent</button><button className={favorites ? 'active' : ''} onClick={() => setFavorites(true)}><Star size={11} />Favorites</button></div><div className="floating-items">{recent.map(item => { const Icon = icons[item.kind]; return <button key={item.path} onClick={() => open(item)} draggable onDragStart={event => { event.preventDefault(); void window.syncit.dragOut(item.path).catch(error => notify(String(error))); }}><Icon size={15} /><span>{item.name}</span><ArrowUpRight size={13} /></button>; })}{!recent.length && <p>{favorites ? 'Star items in the dashboard to list them here.' : 'Nothing in the collection yet.'}</p>}</div><footer className="floating-footer"><span className="status-dot" />{status}</footer></>}</>}
  </section>;
}

// The drawer's pile: a place to drop, and the last few things in the satchel, with where they came from.
function Pile({ items, open, media, expand, paste, busy }: { items: LibraryItem[]; open: (item: LibraryItem) => void; media: (item: LibraryItem) => string; expand: () => void; paste: () => Promise<void>; busy: boolean }) {
  const recent = items.slice(0, 12);
  return <div className="pile">
    <div className="pile-drop"><ArrowDownToLine size={20} /><h2>Drop here</h2><p>Files, text or a screenshot. It goes in the satchel on every computer.</p><div className="pile-actions"><button disabled={busy} aria-label="Paste from clipboard" onClick={() => void paste()}><Clipboard size={14} />Paste</button><button onClick={expand}><FileText size={14} />Write a note</button></div></div>
    <div className="pile-items">{recent.map(item => { const Icon = icons[item.kind]; return <button key={item.path} onClick={() => open(item)} title={item.name} draggable onDragStart={event => { event.preventDefault(); void window.syncit.dragOut(item.path).catch(() => {}); }}>{item.kind === 'image' || item.kind === 'video' ? <img src={media(item)} alt="" loading="lazy" onLoad={event => event.currentTarget.classList.add('loaded')} /> : <span className="pile-icon"><Icon size={15} /></span>}<span className="pile-name">{item.kind === 'note' ? item.name.replace(/\.(md|txt)$/i, '') : item.name}</span>{item.arrivedFrom && <em>from {item.arrivedFrom}</em>}</button>; })}{!recent.length && <p>Nothing in the collection yet.</p>}</div>
    <button className="pile-expand" onClick={expand}>Open the full window<ArrowUpRight size={13} /></button>
  </div>;
}
