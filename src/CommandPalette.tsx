import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';
import type { LibraryItem } from '../shared/types';
export interface Command { label: string; hint: string; run: () => void }
export function CommandPalette({ commands, items, open, close }: { commands: Command[]; items: LibraryItem[]; open: (item: LibraryItem) => void; close: () => void }) {
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const previous = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => { input.current?.focus(); return () => previous.current?.focus(); }, []);
  const results = [...commands, ...items.map(item => ({ label: item.name, hint: item.kind[0].toUpperCase() + item.kind.slice(1), run: () => open(item), text: item.preview }))].filter(item => `${item.label} ${'text' in item ? item.text : ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 12);
  function execute(index: number) { const command = results[index]; if (command) { close(); command.run(); } }
  return <div className="modal-shade command-shade" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected(current => Math.max(0, Math.min(results.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))); }
    if (event.key === 'Enter') { event.preventDefault(); execute(selected); }
    if (event.key === 'Tab') { event.preventDefault(); input.current?.focus(); }
  }}><div className="command-input"><Search size={20} /><input ref={input} role="combobox" aria-label="Search commands and files" aria-controls="command-results" aria-expanded="true" aria-activedescendant={results.length ? `command-${selected}` : undefined} placeholder="Search commands and files…" value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} /><kbd>ESC</kbd></div><div className="command-results" id="command-results" role="listbox">{results.map((command, index) => <button id={`command-${index}`} role="option" aria-selected={selected === index} className={selected === index ? 'selected' : ''} key={`${command.label}-${index}`} onMouseMove={() => setSelected(index)} onClick={() => execute(index)}><ArrowUpRight size={15} /><span>{command.label}</span><small>{command.hint}</small></button>)}{!results.length && <p>No matching commands or files.</p>}</div><footer>{results.length} {results.length === 1 ? 'match' : 'matches'}<span>↑ ↓ navigate · ↵ open · esc close</span></footer></section></div>;
}
