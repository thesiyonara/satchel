import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMarkdown, plainText } from '../src/markdown-parse';

test('Markdown preview parses structure into an inert tree', () => {
  const blocks = parseMarkdown('# Title\n\nSome *emphasis* and **strong** text with `code`.\n\n- one\n- two\n  continued\n1. first\n2) second\n\n> quoted\n> lines\n\n```js\nconst x = 1;\n```\n\n---\nLast paragraph');
  assert.deepEqual(blocks.map(block => block.type), ['heading', 'paragraph', 'list', 'list', 'quote', 'code', 'rule', 'paragraph']);
  assert.equal((blocks[0] as { level: number }).level, 1);
  const list = blocks[2] as { ordered: boolean; items: unknown[][] };
  assert.equal(list.ordered, false); assert.equal(list.items.length, 2);
  assert.deepEqual(list.items[1], [{ type: 'text', text: 'two continued' }]);
  assert.equal((blocks[3] as { ordered: boolean }).ordered, true);
  assert.deepEqual((blocks[5] as { language: string; text: string }), { type: 'code', language: 'js', text: 'const x = 1;' });
});
test('Markdown inline parsing never yields markup, follows no links and flattens images', () => {
  assert.deepEqual(parseInline('a **b** _c_ `d` [e](https://x.test/p) ![alt](https://x.test/i.png) <script>alert(1)</script>'), [
    { type: 'text', text: 'a ' }, { type: 'strong', text: 'b' }, { type: 'text', text: ' ' }, { type: 'em', text: 'c' }, { type: 'text', text: ' ' }, { type: 'code', text: 'd' }, { type: 'text', text: ' ' },
    { type: 'link', text: 'e', url: 'https://x.test/p' }, { type: 'text', text: ' ' }, { type: 'text', text: '[image: alt]' }, { type: 'text', text: ' <script>alert(1)</script>' }
  ]);
  assert.deepEqual(parseMarkdown('first line\nsecond line')[0], { type: 'paragraph', inline: [{ type: 'text', text: 'first line' }, { type: 'break' }, { type: 'text', text: 'second line' }] });
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown('```\nunterminated'), [{ type: 'code', language: '', text: 'unterminated' }]);
});

test('card previews show note text without Markdown syntax', () => {
  assert.equal(plainText('# Trip plan\n\n**Friday** leave after lunch\n*Saturday* the coast road\n\n> Pack the good camera.\n\n- beans\n- rice\n\n1. first\n\n`code` and [a link](https://x.test) and <b>no html</b>'),
    'Trip plan\nFriday leave after lunch\nSaturday the coast road\nPack the good camera.\n• beans\n• rice\n1. first\ncode and a link and <b>no html</b>');
  assert.equal(plainText(''), '');
});
