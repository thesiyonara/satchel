import type { ReactNode } from 'react';
import { inlineText, parseMarkdown, type Inline } from './markdown-parse';

function renderInline(inline: Inline[]): ReactNode[] {
  return inline.map((part, index) => {
    if (part.type === 'code') return <code key={index}>{part.text}</code>;
    if (part.type === 'strong') return <strong key={index}>{part.text}</strong>;
    if (part.type === 'em') return <em key={index}>{part.text}</em>;
    // Links are displayed, never followed: the renderer cannot navigate or reach the network.
    if (part.type === 'link') return <span key={index} className="md-link" title={part.url}>{part.text}</span>;
    if (part.type === 'break') return <br key={index} />;
    return <span key={index}>{part.text}</span>;
  });
}

/** Read-only rendering of a note. Built from a parsed tree, so note contents can never inject markup. */
export function Markdown({ source, omitTitle }: { source: string; omitTitle?: string }) {
  let blocks = parseMarkdown(source);
  // The editor shows the note's title above the text, so a leading heading that repeats it is not rendered twice.
  if (omitTitle && blocks[0]?.type === 'heading' && inlineText(blocks[0].inline).trim() === omitTitle.trim()) blocks = blocks.slice(1);
  if (!blocks.length) return <p className="md-empty">Nothing to preview yet.</p>;
  return <>{blocks.map((block, index) => {
    switch (block.type) {
      case 'heading': { const Tag = `h${Math.min(block.level + 1, 6)}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6'; return <Tag key={index}>{renderInline(block.inline)}</Tag>; }
      case 'code': return <pre key={index} data-language={block.language || undefined}><code>{block.text}</code></pre>;
      case 'quote': return <blockquote key={index}>{renderInline(block.inline)}</blockquote>;
      case 'list': return block.ordered ? <ol key={index}>{block.items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}</ol> : <ul key={index}>{block.items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}</ul>;
      case 'rule': return <hr key={index} />;
      default: return <p key={index}>{renderInline(block.inline)}</p>;
    }
  })}</>;
}
