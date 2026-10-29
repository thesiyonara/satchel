import { Minus, Plus } from 'lucide-react';

/** Zoom out, the percentage (click it for 100%), zoom in. Shared by the grid and the pinboard. */
export function Zoom({ value, change, title }: { value: number; change: (next: number) => void; title: string }) {
  return <div className="zoom" title={title}>
    <button aria-label="Zoom out" onClick={() => change(value - .1)}><Minus size={15} /></button>
    <button className="zoom-value" aria-label="Reset zoom" title="Back to 100%" onClick={() => change(1)}>{Math.round(value * 100)}%</button>
    <button aria-label="Zoom in" onClick={() => change(value + .1)}><Plus size={15} /></button>
  </div>;
}

/** Keeps a zoom factor in a range, rounded to tenths, and remembers it per computer. */
export function useZoom(key: string, min: number, max: number) {
  const read = () => { try { return Math.min(max, Math.max(min, Number(localStorage.getItem(key)) || 1)); } catch { return 1; } };
  return { read, store: (value: number) => { const next = Math.round(Math.min(max, Math.max(min, value)) * 10) / 10; try { localStorage.setItem(key, String(next)); } catch { /* per-computer convenience only */ } return next; } };
}

/** Ctrl/⌘ + wheel over an element changes a zoom instead of the page. A native listener, so the page zoom can be prevented. */
export function wheelZoom(element: HTMLElement | null, change: (step: number) => void) {
  if (!element) return () => {};
  const listener = (event: WheelEvent) => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); change(event.deltaY < 0 ? .1 : -.1); };
  element.addEventListener('wheel', listener, { passive: false });
  return () => element.removeEventListener('wheel', listener);
}
