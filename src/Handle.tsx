// The drawer handle: a thin strip in its own small window at a screen edge. Hovering it, or dragging a file onto it,
// opens the drawer; dropping on the handle itself adds the files straight away.
import { useEffect, useRef, useState } from 'react';

export function Handle() {
  const [hot, setHot] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [preparingUpdate, setPreparingUpdate] = useState(false);
  useEffect(() => { void window.syncit.initial().then(state => setReceiving(state.sync.incoming.length > 0)).catch(() => {}); return window.syncit.onSync(state => setReceiving(state.incoming.length > 0)); }, []);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The handle has no editor to save, but participates in the all-window update handshake.
  useEffect(() => window.syncit.onPrepareUpdate(async prepare => { clearTimeout(timer.current); setPreparingUpdate(prepare); }), []);
  useEffect(() => { document.documentElement.classList.add('handle-page'); return () => document.documentElement.classList.remove('handle-page'); }, []);
  const open = () => { void window.syncit.openDrawer().catch(() => {}); };
  return <div className={`handle ${hot ? 'hot' : ''} ${receiving ? 'receiving' : ''}`} inert={preparingUpdate || undefined} role="presentation" title={receiving ? 'Satchel drawer · something is arriving' : 'Satchel drawer'}
    onMouseEnter={() => { clearTimeout(timer.current); timer.current = setTimeout(open, 350); }}
    onMouseLeave={() => clearTimeout(timer.current)}
    onDragEnter={event => { event.preventDefault(); setHot(true); open(); }}
    onDragOver={event => event.preventDefault()}
    onDragLeave={() => setHot(false)}
    onDrop={event => { event.preventDefault(); setHot(false); const paths = window.syncit.pathsForFiles(Array.from(event.dataTransfer.files)); if (paths.length) void window.syncit.importFiles(paths).catch(() => {}); }}><span /></div>;
}
