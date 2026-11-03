import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export type MenuEntry = { label: string; icon?: ReactNode; run: () => void; disabled?: boolean; danger?: boolean } | 'separator';

/**
 * A menu at the pointer, for a right-click on something that has no menu of its own: the collection's background, the sidebar. It keeps
 * inside the window, the arrow keys walk it, Enter picks, and a click elsewhere, Escape, the wheel or a resize put it away.
 */
export function ContextMenu({ at, items, close }: { at: { x: number; y: number }; items: MenuEntry[]; close: () => void }) {
  const element = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(at);
  useLayoutEffect(() => {
    const box = element.current?.getBoundingClientRect(); if (!box) return;
    setPosition({ x: Math.max(8, Math.min(at.x, innerWidth - box.width - 8)), y: Math.max(8, Math.min(at.y, innerHeight - box.height - 8)) });
    element.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  }, [at]);
  useEffect(() => {
    const away = (event: Event) => { if (!element.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const buttons = [...element.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    };
    document.addEventListener('pointerdown', away, true); document.addEventListener('contextmenu', away, true); document.addEventListener('wheel', close, true); // the wheel, not scroll events: focusing the menu can scroll the grid behind it
    window.addEventListener('keydown', key, true); window.addEventListener('resize', close); window.addEventListener('blur', close);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('contextmenu', away, true); document.removeEventListener('wheel', close, true); window.removeEventListener('keydown', key, true); window.removeEventListener('resize', close); window.removeEventListener('blur', close); };
  }, [close]);
  return <div ref={element} className="context-menu" role="menu" style={{ left: position.x, top: position.y }} onContextMenu={event => event.preventDefault()}>
    {items.map((entry, index) => entry === 'separator' ? <hr key={index} /> : <button key={index} role="menuitem" className={entry.danger ? 'danger' : ''} disabled={entry.disabled} onClick={() => { close(); entry.run(); }}>{entry.icon}{entry.label}</button>)}
  </div>;
}
