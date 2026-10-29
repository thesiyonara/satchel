import { useEffect, useRef, useState } from 'react';
import { ArrowUpToLine, ChevronRight, ClipboardCopy, Eraser, X } from 'lucide-react';
import type { Pasteboard as PasteboardState, PasteboardClip } from '../shared/types';

const OPEN_KEY = 'pasteboardOpen';
function label(clip: PasteboardClip) { const line = clip.text.trim().split('\n')[0] || ''; return line.length > 30 ? line.slice(0, 30).trimEnd() + '…' : line; }

/**
 * The pasteboard column on the right of the main window: one shared text area, live between the paired computers, with the texts it replaced
 * listed under it. Typing saves a moment later; a change from another computer replaces the text unless an edit is still on its way from here.
 * The column folds to a tab on the edge and remembers that per computer.
 */
export function Pasteboard({ board, notify, since }: { board?: PasteboardState; notify: (message: string) => void; since: (time: number) => string }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; } });
  const [text, setText] = useState(board?.text ?? '');
  const [state, setState] = useState<'synced' | 'typing' | 'saving'>('synced');
  const edits = useRef(0); const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!pending.current) setText(board?.text ?? ''); }, [board?.text, board?.updatedAt]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // The command palette opens the column and puts the cursor in the text.
  useEffect(() => {
    const show = () => { toggle(true); setTimeout(() => area.current?.focus(), 50); };
    window.addEventListener('syncit:pasteboard', show); return () => window.removeEventListener('syncit:pasteboard', show);
  }, []);
  const toggle = (next: boolean) => { setOpen(next); try { localStorage.setItem(OPEN_KEY, next ? '1' : '0'); } catch { /* per-computer convenience only */ } };
  const save = async (value: string) => {
    const edit = edits.current; setState('saving');
    try { await window.syncit.savePasteboard(value); if (edits.current === edit) { pending.current = false; setState('synced'); } }
    catch (error) { notify(String(error)); setState('typing'); }
  };
  const change = (value: string) => { setText(value); edits.current++; pending.current = true; setState('typing'); clearTimeout(timer.current); timer.current = setTimeout(() => void save(value), 400); };
  const replace = (value: string) => { clearTimeout(timer.current); setText(value); edits.current++; pending.current = true; void save(value); };
  const copy = async (value: string, what: string) => { try { await navigator.clipboard.writeText(value); notify(`${what} copied.`); } catch { notify('The clipboard is unavailable.'); } };
  const use = async (clip: PasteboardClip) => { try { await window.syncit.removeClip(clip.id); } catch (error) { notify(String(error)); return; } replace(clip.text); area.current?.focus(); };
  const remove = async (clip?: PasteboardClip) => { try { await window.syncit.removeClip(clip?.id); } catch (error) { notify(String(error)); } };
  const recent = board?.recent ?? [];
  const status = state === 'saving' ? 'Saving…' : state === 'typing' ? 'Typing…' : board?.updatedAt ? `Changed ${since(board.updatedAt).toLowerCase()}${board.from ? ` from ${board.from}` : ''}` : 'Nothing here yet';
  if (!open) return <aside className="pasteboard closed" aria-label="Pasteboard"><button className="pasteboard-tab" aria-label="Show pasteboard" title="Show the pasteboard" onClick={() => toggle(true)}><span>Pasteboard</span></button></aside>;
  return <aside className="pasteboard" aria-label="Pasteboard">
    <div className="pasteboard-head"><div><h2>Pasteboard</h2><small><span className="live"><i />Live on every paired computer</span><br />{status}</small></div>
      <div className="tools"><button className="icon-button" aria-label="Copy all" title="Copy all" disabled={!text} onClick={() => void copy(text, 'Pasteboard')}><ClipboardCopy size={15} /></button><button className="icon-button" aria-label="Clear" title="Clear the text (it goes to Recent)" disabled={!text} onClick={() => { replace(''); area.current?.focus(); }}><Eraser size={15} /></button><button className="icon-button" aria-label="Hide pasteboard" title="Hide the pasteboard" onClick={() => toggle(false)}><ChevronRight size={15} /></button></div></div>
    <textarea ref={area} aria-label="Pasteboard text" placeholder="Paste or type here. It shows up on your other computers within seconds." value={text} onChange={event => change(event.target.value)} spellCheck={false} />
    <div className="recent-head"><span>Recent</span>{recent.length > 0 && <button onClick={() => void remove()}>Clear list</button>}</div>
    <div className="recent">
      {recent.length === 0 ? <p className="recent-empty">When the text is replaced, the old one lands here.</p> : recent.map(clip => <div key={clip.id} className="clip">
        <button className="clip-text" title="Copy" onClick={() => void copy(clip.text, 'Text')}>{clip.text}</button>
        <small>{since(clip.time)}{clip.from ? ` · from ${clip.from}` : ''}</small>
        <div className="clip-tools"><button className="icon-button" aria-label={`Copy ${label(clip)}`} title="Copy" onClick={() => void copy(clip.text, 'Text')}><ClipboardCopy size={14} /></button><button className="icon-button" aria-label={`Put ${label(clip)} on the board`} title="Put it back on the board" onClick={() => void use(clip)}><ArrowUpToLine size={14} /></button><button className="icon-button" aria-label={`Remove ${label(clip)}`} title="Remove" onClick={() => void remove(clip)}><X size={14} /></button></div>
      </div>)}
    </div>
  </aside>;
}
