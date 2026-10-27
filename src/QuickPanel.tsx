import { useEffect, useRef, useState } from 'react';
import { ArrowLeftToLine, ArrowRightToLine, ArrowUpRight, Blend, Clipboard, Expand, FileText, Film, Image, File, Minimize2, Music, Pin, Plus, Star, X } from 'lucide-react';
import type { LibraryItem, Settings } from '../shared/types';

const icons = { note: FileText, image: Image, video: Film, audio: Music, file: File };
export function QuickPanel({ settings, items, status, platform, open, paste, notify }: { settings: Settings; items: LibraryItem[]; status: string; platform: string; open: (item: LibraryItem) => void; paste: () => Promise<void>; notify: (message: string) => void }) {
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
    <header className="floating-titlebar"><span className="floating-wordmark">s<span>/</span>i</span><span className="floating-mode">{mini ? 'CAPTURE' : 'QUICK DROP'}</span><div>
      <button aria-label="Window opacity" aria-pressed={opacityOpen} title={`Opacity ${opacity}%`} onClick={() => setOpacityOpen(value => !value)}><Blend size={14} /></button>
      <button aria-label="Keep floating window on top" aria-pressed={settings.alwaysOnTop} onClick={() => void perform(() => window.syncit.settings({ alwaysOnTop: !settings.alwaysOnTop }))}><Pin size={14} /></button>
      <button aria-label={mini ? 'Expand floating window' : 'Minimal floating window'} onClick={() => void perform(() => window.syncit.settings({ panelMode: mini ? 'quick' : 'mini' }))}>{mini ? <Expand size={14} /> : <Minimize2 size={14} />}</button>
      <button aria-label="Hide floating window" onClick={() => void window.syncit.panel('hide')}><X size={15} /></button>
    </div></header>
    {opacityOpen && <div className="floating-opacity"><Blend size={13} /><input type="range" min="60" max="100" step="5" aria-label="Floating window opacity" value={opacity} onChange={event => changeOpacity(Number(event.target.value))} /><span>{opacity}%</span></div>}
    {!mini && <div className="floating-intro"><h2>Add to the collection</h2><p>Write, paste or drop. Everything lands in the collection and on paired computers.</p></div>}
    <form className="capture-composer" onSubmit={event => { event.preventDefault(); void save(); }}>
      <textarea aria-label="Quick capture text" placeholder="Write a note…" value={text} onChange={event => { setText(event.target.value); try { localStorage.setItem(key, event.target.value); } catch { notify('Draft storage is full. Capture this text before closing.'); } }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save(); } }} />
      <div><span>{captured && !text ? 'Saved to the collection' : `${modifier} + Enter to capture`}</span><button className="capture-submit" aria-label="Save quick capture" disabled={busy || !text.trim()}><Plus size={14} />Capture</button></div>
    </form>
    <div className="floating-tools"><button disabled={busy} aria-label="Paste from clipboard" onClick={() => void perform(paste)}><Clipboard size={14} />Paste</button>{!mini && <button disabled={busy} onClick={() => void perform(() => window.syncit.chooseFiles())}>Add files</button>}<span /><span className="dock-group"><button title="Dock to the left edge" aria-label="Dock left" onClick={() => void window.syncit.panel('left')}><ArrowLeftToLine size={14} /></button><button title="Dock to the right edge" aria-label="Dock right" onClick={() => void window.syncit.panel('right')}><ArrowRightToLine size={14} /></button></span><button aria-label="Open dashboard" title="Open the main window" onClick={() => void window.syncit.showDashboard()}>Dashboard<ArrowUpRight size={14} /></button></div>
    {!mini && <><div className="floating-tabs"><button className={!favorites ? 'active' : ''} onClick={() => setFavorites(false)}>RECENT</button><button className={favorites ? 'active' : ''} onClick={() => setFavorites(true)}><Star size={11} />FAVORITES</button></div><div className="floating-items">{recent.map(item => { const Icon = icons[item.kind]; return <button key={item.path} onClick={() => open(item)}><Icon size={15} /><span>{item.name}</span><ArrowUpRight size={13} /></button>; })}{!recent.length && <p>{favorites ? 'Star items in the dashboard to list them here.' : 'Nothing in the collection yet.'}</p>}</div><footer className="floating-footer"><span className="status-dot" />{status}</footer></>}
  </section>;
}
