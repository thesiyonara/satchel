import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';

function highlightedText(text: string) {
  const parts: React.ReactNode[] = [];
  // Keep separators outside the highlight, including the prose around a parenthesized URL.
  const pattern = /(?<![\w@./-])(?:https?:\/\/[^\s<>"'`]+|(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,63}\b(?::\d+)?(?:[/?#][^\s<>"'`]*)?)/gi;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    let url = match[0].replace(/[.,;:!?]+$/, '');
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      const extra = url.split(close).length - url.split(open).length;
      for (let count = 0; count < extra && url.endsWith(close); count++) url = url.slice(0, -1);
    }
    try { new URL(/^https?:/i.test(url) ? url : 'https://' + url); } catch { continue; }
    parts.push(text.slice(end, match.index), <mark key={match.index}>{url}</mark>);
    end = match.index + url.length;
  }
  parts.push(text.slice(end));
  return parts;
}

export function PasteboardText({ text }: { text: string }) {
  return useMemo(() => highlightedText(text), [text]);
}

export function PasteboardInput({ value, change, placeholder, inputRef }: {
  value: string; change: (value: string) => void; placeholder: string; inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const local = useRef<HTMLTextAreaElement>(null);
  const area = inputRef ?? local;
  const mirror = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const field = area.current!, overlay = mirror.current!;
    const align = () => {
      overlay.style.width = field.clientWidth + 'px';
      overlay.style.height = field.clientHeight + 'px';
      overlay.scrollTop = field.scrollTop;
      overlay.scrollLeft = field.scrollLeft;
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(field);
    field.addEventListener('scroll', align);
    return () => { observer.disconnect(); field.removeEventListener('scroll', align); };
  }, [area]);
  return <div className="paste-input">
    <textarea ref={area} aria-label="Pasteboard text" placeholder={placeholder} value={value} onChange={event => change(event.target.value)} spellCheck={false} />
    <div className="paste-mirror" ref={mirror} aria-hidden="true"><PasteboardText text={value} />{'\u200b'}</div>
  </div>;
}
