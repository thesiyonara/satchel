// A deliberately small Markdown reader for note previews. It produces a tree, never HTML, so
// notes stay inert: no raw HTML, no scripts, no remote images, and links are shown but not followed.
export type Inline = { type: 'text' | 'code' | 'strong' | 'em'; text: string } | { type: 'link'; text: string; url: string } | { type: 'break' };
export type Block =
  | { type: 'heading'; level: number; inline: Inline[] }
  | { type: 'paragraph'; inline: Inline[] }
  | { type: 'code'; language: string; text: string }
  | { type: 'quote'; inline: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'rule' };

const inlinePattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(\b_[^_\n]+_\b)|(!?\[[^\]\n]*\]\([^)\s]+\))/g;
/** Notes are written line by line, so a single newline inside a paragraph is kept as a line break. */
export function parseInline(text: string): Inline[] {
  if (text.includes('\n')) return text.split('\n').flatMap((line, index) => index ? [{ type: 'break' } as Inline, ...parseInline(line)] : parseInline(line));
  const result: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(inlinePattern)) {
    const index = match.index ?? 0;
    if (index > last) result.push({ type: 'text', text: text.slice(last, index) });
    const token = match[0];
    if (token.startsWith('`')) result.push({ type: 'code', text: token.slice(1, -1) });
    else if (token.startsWith('**') || token.startsWith('__')) result.push({ type: 'strong', text: token.slice(2, -2) });
    else if (token.startsWith('*') || token.startsWith('_')) result.push({ type: 'em', text: token.slice(1, -1) });
    else {
      const link = /^(!?)\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token)!;
      if (link[1]) result.push({ type: 'text', text: `[image: ${link[2] || link[3]}]` });
      else result.push({ type: 'link', text: link[2] || link[3], url: link[3] });
    }
    last = index + token.length;
  }
  if (last < text.length) result.push({ type: 'text', text: text.slice(last) });
  return result;
}

export function inlineText(inline: Inline[]) { return inline.map(part => part.type === 'break' ? '\n' : part.text).join(''); }
/** The note as readable lines without Markdown syntax: headings and emphasis stripped, lists bulleted, code kept. */
export function plainText(source: string): string {
  return parseMarkdown(source).map(block => {
    if (block.type === 'rule') return '';
    if (block.type === 'code') return block.text;
    if (block.type === 'list') return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '•'} ${inlineText(item)}`).join('\n');
    return inlineText(block.inline);
  }).filter(Boolean).join('\n');
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) { blocks.push({ type: 'paragraph', inline: parseInline(paragraph.map(line => line.trim()).join('\n')) }); paragraph = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) code.push(lines[i]);
      blocks.push({ type: 'code', language: fence[1], text: code.join('\n') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { flush(); blocks.push({ type: 'heading', level: heading[1].length, inline: parseInline(heading[2]) }); continue; }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); blocks.push({ type: 'rule' }); continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const quote: string[] = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, ''));
      i--; blocks.push({ type: 'quote', inline: parseInline(quote.join(' ').trim()) }); continue;
    }
    const item = /^\s*(?:([-*+])|(\d{1,3}[.)]))\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const ordered = !!item[2]; const items: string[] = [];
      for (; i < lines.length; i++) {
        const next = /^\s*(?:([-*+])|(\d{1,3}[.)]))\s+(.*)$/.exec(lines[i]);
        if (next && !!next[2] === ordered) items.push(next[3]);
        else if (items.length && /^\s{2,}\S/.test(lines[i])) items[items.length - 1] += ' ' + lines[i].trim();
        else break;
      }
      i--; blocks.push({ type: 'list', ordered, items: items.map(parseInline) }); continue;
    }
    if (!line.trim()) { flush(); continue; }
    paragraph.push(line);
  }
  flush();
  return blocks;
}
