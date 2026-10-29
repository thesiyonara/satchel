import { useEffect, useRef, useState } from 'react';
import { ClipboardCopy, Eraser } from 'lucide-react';
import type { Pasteboard as PasteboardState } from '../shared/types';

/** One shared text area. What is typed or pasted here is saved a moment later and reaches every paired computer; a change from another computer replaces the text unless an edit is still on its way from here. */
export function Pasteboard({ board, notify, since }: { board?: PasteboardState; notify: (message: string) => void; since: (time: number) => string }) {
  const [text, setText] = useState(board?.text ?? '');
  const [state, setState] = useState<'synced' | 'typing' | 'saving'>('synced');
  const edits = useRef(0); const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!pending.current) setText(board?.text ?? ''); }, [board?.text, board?.updatedAt]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const save = async (value: string) => {
    const edit = edits.current; setState('saving');
    try { await window.syncit.savePasteboard(value); if (edits.current === edit) { pending.current = false; setState('synced'); } }
    catch (error) { notify(String(error)); setState('typing'); }
  };
  const change = (value: string) => { setText(value); edits.current++; pending.current = true; setState('typing'); clearTimeout(timer.current); timer.current = setTimeout(() => void save(value), 400); };
  const copy = async () => { try { await navigator.clipboard.writeText(text); notify('Pasteboard copied.'); } catch { notify('The clipboard is unavailable.'); } };
  const clear = () => { clearTimeout(timer.current); setText(''); edits.current++; pending.current = true; void save(''); area.current?.focus(); };
  const status = state === 'saving' ? 'Saving…' : state === 'typing' ? 'Typing…' : board?.updatedAt ? `Changed ${since(board.updatedAt).toLowerCase()}` : 'Nothing here yet';
  return <section className="pasteboard" aria-label="Pasteboard">
    <div className="pasteboard-head"><div><h1>Pasteboard</h1><small>One text shared with every paired computer, live. {status}.</small></div>
      <div className="row"><button disabled={!text} onClick={() => void copy()}><ClipboardCopy size={15} />Copy all</button><button disabled={!text} onClick={clear}><Eraser size={15} />Clear</button></div></div>
    <textarea ref={area} aria-label="Pasteboard text" placeholder="Paste or type here. It shows up on your other computers within seconds." value={text} onChange={event => change(event.target.value)} spellCheck={false} />
  </section>;
}
