import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Minus, Plus, Move, Pin, X } from 'lucide-react';
import type { BoardPlacement, LibraryItem } from '../shared/types';

export function Board({ items, placements, renderCard, notify }: { items: LibraryItem[]; placements: BoardPlacement[]; renderCard: (item: LibraryItem) => React.ReactNode; notify: (message: string) => void }) {
  const [zoom, setZoom] = useState(() => Number(localStorage.getItem('boardZoom')) || 1);
  const [draft, setDraft] = useState<BoardPlacement | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ placement: BoardPlacement; startX: number; startY: number; mode: 'move' | 'resize' } | null>(null);
  const assigned = new Set(placements.map(p => p.path));
  const unplaced = items.filter(item => !assigned.has(item.path));
  const visible = placements.map(p => draft?.path === p.path ? draft : p).filter(p => items.some(item => item.path === p.path));
  const width = Math.max(1500, ...visible.map(p => p.x + p.width + 200));
  const height = Math.max(1000, ...visible.map(p => p.y + p.height + 200));
  function setScale(value: number) { const next = Math.round(Math.min(1.5, Math.max(.4, value)) * 10) / 10; setZoom(next); localStorage.setItem('boardZoom', String(next)); }
  async function pin(item: LibraryItem, x?: number, y?: number) {
    const offset = placements.length % 5;
    try { await window.syncit.place({ version: 1, path: item.path, x: x ?? 40 + offset * 40, y: y ?? 40 + offset * 40, width: 280, height: 290, updatedAt: Date.now() }); }
    catch (error) { notify(String(error)); }
  }
  function start(event: ReactPointerEvent, placement: BoardPlacement, mode: 'move' | 'resize') {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { placement, startX: event.clientX, startY: event.clientY, mode }; setDraft(placement);
  }
  function move(event: ReactPointerEvent) {
    const current = gesture.current; if (!current) return;
    const dx = (event.clientX - current.startX) / zoom; const dy = (event.clientY - current.startY) / zoom;
    const p = current.placement;
    setDraft(current.mode === 'move' ? { ...p, x: Math.min(20000, Math.max(0, p.x + dx)), y: Math.min(20000, Math.max(0, p.y + dy)) } : { ...p, width: Math.min(1200, Math.max(200, p.width + dx)), height: Math.min(1200, Math.max(180, p.height + dy)) });
  }
  function finish() {
    if (draft && gesture.current) void window.syncit.place(draft).catch(error => notify(String(error))).finally(() => setDraft(null));
    gesture.current = null;
  }
  return <div className="board-wrapper">
    <div className="board-hint"><span><Move size={14} /> Drag the handle to move a card, the corner to resize. Positions sync to paired computers.</span><div className="zoom"><button aria-label="Zoom out" onClick={() => setScale(zoom - .1)}><Minus size={15} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" onClick={() => setScale(zoom + .1)}><Plus size={15} /></button></div></div>
    <div className="board-scroll" ref={scroll} onDragOver={event => { if (event.dataTransfer.types.includes('application/x-syncit-item')) event.preventDefault(); }} onDrop={event => {
      const relative = event.dataTransfer.getData('application/x-syncit-item'); const item = items.find(item => item.path === relative);
      if (!item || !scroll.current) return;
      event.preventDefault(); event.stopPropagation();
      const rect = scroll.current.getBoundingClientRect();
      void pin(item, Math.max(0, (event.clientX - rect.left + scroll.current.scrollLeft) / zoom), Math.max(0, (event.clientY - rect.top + scroll.current.scrollTop) / zoom));
    }}>
      <div style={{ width: width * zoom, height: height * zoom }}>
        <div className="board-canvas" style={{ width, height, transform: `scale(${zoom})` }}>
          {!visible.length && <div className="board-empty"><Pin size={30} strokeWidth={1.3} /><h3>No cards yet.</h3><p>Pin an item from the strip below, or drag it onto the canvas.</p></div>}
          {visible.map(placement => <div className="board-card" key={placement.path} style={{ left: placement.x, top: placement.y, width: placement.width, height: placement.height, zIndex: draft?.path === placement.path ? 10 : 1 }}>
            <div className="board-handle" onPointerDown={event => start(event, placement, 'move')} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { gesture.current = null; setDraft(null); }}><Move size={13} /><span>{items.find(item => item.path === placement.path)?.name}</span><button title="Unpin from board" onPointerDown={event => event.stopPropagation()} onClick={() => void window.syncit.unpin(placement.path).catch(error => notify(String(error)))}><X size={13} /></button></div>
            {renderCard(items.find(item => item.path === placement.path)!)}
            <div role="slider" aria-label={`Resize ${placement.path}`} aria-valuenow={Math.round(placement.width)} tabIndex={0} className="resize-handle" onPointerDown={event => start(event, placement, 'resize')} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { gesture.current = null; setDraft(null); }} onKeyDown={event => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); void window.syncit.place({ ...placement, width: Math.max(200, Math.min(1200, placement.width + (event.key === 'ArrowRight' ? 20 : -20))) }).catch(error => notify(String(error))); }
            }} />
          </div>)}
        </div>
      </div>
    </div>
    <div className="unplaced-strip"><div className="unplaced-label">NOT ON THE BOARD <span>{unplaced.length}</span></div>{unplaced.length === 0 ? <p>Every item is on the board.</p> : unplaced.map(item => <button key={item.path} draggable onDragStart={event => event.dataTransfer.setData('application/x-syncit-item', item.path)} onClick={() => void pin(item)} title={`Pin ${item.name}`}><Plus size={14} />{item.name}</button>)}</div>
  </div>;
}
