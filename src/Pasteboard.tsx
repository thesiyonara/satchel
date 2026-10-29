import { useEffect, useRef, useState } from 'react';
import { ArrowUpToLine, ChevronRight, ClipboardCopy, Eraser, X } from 'lucide-react';
import type { Pasteboard as PasteboardState, PasteboardClip } from '../shared/types';

const OPEN_KEY = 'pasteboardOpen';
const SEEN_KEY = 'pasteboardSeenAt';
const WIDTH_KEY = 'pasteboardWidth';
const DEFAULT_WIDTH = 340;
const clampWidth = (value: number) => Math.min(640, Math.max(260, Math.round(value)));
function label(clip: PasteboardClip) { const line = clip.text.trim().split('\n')[0] || ''; return line.length > 30 ? line.slice(0, 30).trimEnd() + '…' : line; }

/**
 * The live text, shared by the column in the main window and Quick drop: typing saves a moment later, and a change from another computer
 * replaces the text unless an edit is still on its way from here.
 */
export function useLiveText(board: PasteboardState | undefined, notify: (message: string) => void) {
  const [text, setText] = useState(board?.text ?? '');
  const [state, setState] = useState<'synced' | 'typing' | 'saving'>('synced');
  const edits = useRef(0); const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { if (!pending.current) setText(board?.text ?? ''); }, [board?.text, board?.updatedAt]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const save = async (value: string) => {
    const edit = edits.current; setState('saving');
    try { await window.syncit.savePasteboard(value); if (edits.current === edit) { pending.current = false; setState('synced'); } }
    catch (error) { notify(String(error)); setState('typing'); }
  };
  const change = (value: string) => { setText(value); edits.current++; pending.current = true; setState('typing'); clearTimeout(timer.current); timer.current = setTimeout(() => void save(value), 400); };
  const replace = (value: string) => { clearTimeout(timer.current); setText(value); edits.current++; pending.current = true; void save(value); };
  return { text, state, change, replace };
}

/** One line on where the text stands: saving, typing, or when and where it last changed. */
export function liveStatus(state: 'synced' | 'typing' | 'saving', board: PasteboardState | undefined, since: (time: number) => string) {
  return state === 'saving' ? 'Saving…' : state === 'typing' ? 'Typing…' : board?.updatedAt ? `Changed ${since(board.updatedAt).toLowerCase()}${board.from ? ` from ${board.from}` : ''}` : 'Nothing here yet';
}

/**
 * The pasteboard column on the right of the main window: the shared text area with the texts it replaced listed under it.
 * The column folds to a tab on the edge, its left edge drags to change its width, and both are remembered per computer.
 */
export function Pasteboard({ board, notify, since, peers, hidden, compact }: { board?: PasteboardState; notify: (message: string) => void; since: (time: number) => string; peers: string[]; hidden?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; } });
  // In a window too narrow for the column, it stays a tab and opens over the grid for a moment instead; that choice is not remembered.
  const [peek, setPeek] = useState(false);
  const shown = compact ? peek : open;
  const [width, setWidth] = useState(() => { try { return clampWidth(Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH); } catch { return DEFAULT_WIDTH; } });
  const [resizing, setResizing] = useState(false);
  const gesture = useRef<{ x: number; width: number } | null>(null);
  const resize = (next: number, persist = false) => { const value = clampWidth(next); setWidth(value); if (persist) { try { localStorage.setItem(WIDTH_KEY, String(value)); } catch { /* per-computer convenience only */ } } };
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); gesture.current = { x: event.clientX, width }; setResizing(true); };
  const moveResize = (event: React.PointerEvent) => { if (gesture.current) resize(gesture.current.width + gesture.current.x - event.clientX); };
  const endResize = () => { if (gesture.current) { gesture.current = null; setResizing(false); resize(width, true); } };
  // While the column is open, every change counts as seen; folded, the tab shows a dot for a change that arrived since.
  useEffect(() => { if (shown && board?.updatedAt) { try { localStorage.setItem(SEEN_KEY, String(board.updatedAt)); } catch { /* per-computer convenience only */ } } }, [shown, board?.updatedAt]);
  let seenAt = 0; try { seenAt = Number(localStorage.getItem(SEEN_KEY) || 0); } catch { /* per-computer convenience only */ }
  const unseen = !shown && (board?.updatedAt ?? 0) > seenAt;
  const live = useLiveText(board, notify);
  const area = useRef<HTMLTextAreaElement>(null);
  // The command palette opens the column and puts the cursor in the text.
  useEffect(() => {
    const show = () => { toggle(true); setTimeout(() => area.current?.focus(), 50); };
    window.addEventListener('syncit:pasteboard', show); return () => window.removeEventListener('syncit:pasteboard', show);
  }, []);
  const toggle = (next: boolean) => { if (compact) { setPeek(next); return; } setOpen(next); try { localStorage.setItem(OPEN_KEY, next ? '1' : '0'); } catch { /* per-computer convenience only */ } };
  useEffect(() => { if (!compact) setPeek(false); }, [compact]);
  const copy = async (value: string, what: string) => { try { await navigator.clipboard.writeText(value); notify(`${what} copied.`); } catch { notify('The clipboard is unavailable.'); } };
  const use = async (clip: PasteboardClip) => { try { await window.syncit.removeClip(clip.id); } catch (error) { notify(String(error)); return; } live.replace(clip.text); area.current?.focus(); };
  const remove = async (clip?: PasteboardClip) => { try { await window.syncit.removeClip(clip?.id); } catch (error) { notify(String(error)); } };
  const recent = board?.recent ?? [];
  if (hidden) return null;
  if (!shown) return <aside className="pasteboard closed" aria-label="Pasteboard"><button className="pasteboard-tab" aria-label={unseen ? 'Show pasteboard, changed since you folded it' : 'Show pasteboard'} title={unseen ? 'The pasteboard changed since you folded it' : 'Show the pasteboard'} onClick={() => toggle(true)}><span>Pasteboard</span>{unseen && <i className="unseen" />}</button></aside>;
  return <>{compact && <div className="pasteboard-backdrop" onClick={() => setPeek(false)} />}<aside className={`pasteboard ${resizing ? 'resizing' : ''} ${compact ? 'overlay' : ''}`} aria-label="Pasteboard" style={{ width }}>
    <div className="pasteboard-resizer" role="separator" aria-orientation="vertical" aria-label="Pasteboard width" aria-valuenow={width} aria-valuemin={260} aria-valuemax={640} tabIndex={0} title="Drag to resize · double-click to reset"
      onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} onDoubleClick={() => resize(DEFAULT_WIDTH, true)}
      onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resize(width + (event.key === 'ArrowLeft' ? 20 : -20), true); } }} />
    <div className="pasteboard-head"><div><h2>Pasteboard</h2><small>{peers.length > 0 ? <span className="live" title={peers.join(', ')}><i /><span>Live with {peers.length === 1 ? peers[0] : `${peers.length} computers`}</span></span> : <span className="live off"><i /><span>Syncs once a computer is paired</span></span>}<br />{liveStatus(live.state, board, since)}</small></div>
      <div className="tools"><button className="icon-button" aria-label="Copy all" title="Copy all" disabled={!live.text} onClick={() => void copy(live.text, 'Pasteboard')}><ClipboardCopy size={15} /></button><button className="icon-button" aria-label="Clear" title="Clear the text (it goes to Recent)" disabled={!live.text} onClick={() => { live.replace(''); area.current?.focus(); }}><Eraser size={15} /></button><button className="icon-button" aria-label="Hide pasteboard" title="Hide the pasteboard" onClick={() => toggle(false)}><ChevronRight size={15} /></button></div></div>
    <textarea ref={area} aria-label="Pasteboard text" placeholder="Paste or type here." value={live.text} onChange={event => live.change(event.target.value)} spellCheck={false} />
    <div className="recent-head"><span>Recent</span>{recent.length > 0 && <button onClick={() => void remove()}>Clear list</button>}</div>
    <div className="recent">
      {recent.length === 0 ? <p className="recent-empty">When the text is replaced, the old one lands here.</p> : recent.map(clip => <div key={clip.id} className="clip">
        <button className="clip-text" title="Copy" onClick={() => void copy(clip.text, 'Text')}>{clip.text}</button>
        <small>{since(clip.time)}{clip.from ? ` · from ${clip.from}` : ''}</small>
        <div className="clip-tools"><button className="icon-button" aria-label={`Copy ${label(clip)}`} title="Copy" onClick={() => void copy(clip.text, 'Text')}><ClipboardCopy size={14} /></button><button className="icon-button" aria-label={`Put ${label(clip)} on the board`} title="Put it back on the board" onClick={() => void use(clip)}><ArrowUpToLine size={14} /></button><button className="icon-button" aria-label={`Remove ${label(clip)}`} title="Remove" onClick={() => void remove(clip)}><X size={14} /></button></div>
      </div>)}
    </div>
  </aside></>;
}
