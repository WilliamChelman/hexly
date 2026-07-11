import { markdownToProseMirror, type PMNode } from './markdown-to-pm';

describe('markdownToProseMirror', () => {
  it('parses YAML frontmatter into metadata and drops it from the body', () => {
    const md = '---\ntitle: Hello\ntags:\n  - a\n  - b\n---\nBody text';
    const { doc, metadata } = markdownToProseMirror(md);

    expect(metadata).toEqual({ title: 'Hello', tags: ['a', 'b'] });
    expect(doc.content).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] }]);
  });

  it('degrades non-object frontmatter (a top-level list) to empty metadata, not index-keyed junk', () => {
    const md = '---\n- one\n- two\n---\nBody text';
    const { metadata, degraded } = markdownToProseMirror(md);

    expect(metadata).toEqual({});
    expect(degraded).toEqual({ frontmatter: 1 });
  });

  it('degrades malformed YAML frontmatter instead of throwing', () => {
    const md = '---\na: b: [unclosed\n---\nBody text';
    const { doc, metadata, degraded } = markdownToProseMirror(md);

    expect(metadata).toEqual({});
    expect(degraded).toEqual({ frontmatter: 1 });
    expect(doc.content).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] }]);
  });

  it('converts a paragraph of plain text into a doc with a paragraph node', () => {
    const { doc } = markdownToProseMirror('Hello world');

    expect(doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
    });
  });

  it('merges adjacent text runs whose marks are equal but built in a different order', () => {
    const { doc } = markdownToProseMirror('**_a_**_**b**_');

    expect(doc.content?.[0].content).toEqual([
      {
        type: 'text',
        text: 'ab',
        marks: expect.arrayContaining([{ type: 'bold' }, { type: 'italic' }]),
      },
    ]);
  });

  it('carries emphasis, strong, strikethrough, and code as PM marks on text', () => {
    const { doc } = markdownToProseMirror('a **b** *c* ~~d~~ `e`');

    expect(doc.content?.[0].content).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'c', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'd', marks: [{ type: 'strike' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'e', marks: [{ type: 'code' }] },
    ]);
  });

  it('degrades footnote references to plain markers and counts them', () => {
    const { doc, degraded } = markdownToProseMirror('Cite this[^1].\n\n[^1]: A source.');

    expect(doc.content?.[0].content).toEqual([{ type: 'text', text: 'Cite this[^1].' }]);
    // The definition survives as readable prose.
    expect(doc.content?.[1]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'A source.' }],
    });
    expect(degraded).toEqual({ footnote: 1 });
  });

  it('drops %%comments%% from the body but counts them as degraded', () => {
    const { doc, degraded } = markdownToProseMirror('keep %%secret note%% this');

    expect(doc.content?.[0].content).toEqual([{ type: 'text', text: 'keep  this' }]);
    expect(degraded).toEqual({ comment: 1 });
  });

  it('degrades $inline math$ to inline code and counts it', () => {
    const { doc, degraded } = markdownToProseMirror('mass $E = mc^2$ here');

    expect(doc.content?.[0].content).toEqual([
      { type: 'text', text: 'mass ' },
      { type: 'text', text: 'E = mc^2', marks: [{ type: 'code' }] },
      { type: 'text', text: ' here' },
    ]);
    expect(degraded).toEqual({ math: 1 });
  });

  it('leaves prose with two dollar amounts untouched (not inline math)', () => {
    const { doc, degraded } = markdownToProseMirror('You owe $5 and $10 total');

    expect(doc.content?.[0].content).toEqual([{ type: 'text', text: 'You owe $5 and $10 total' }]);
    expect(degraded).toEqual({});
  });

  it('converts ==text== into a highlight mark, splitting the surrounding text', () => {
    const { doc } = markdownToProseMirror('plain ==lit up== plain');

    expect(doc.content?.[0].content).toEqual([
      { type: 'text', text: 'plain ' },
      { type: 'text', text: 'lit up', marks: [{ type: 'highlight' }] },
      { type: 'text', text: ' plain' },
    ]);
  });

  it('parses wikilink variants into entityLink atoms carrying target/display/heading', () => {
    const link = (md: string) => markdownToProseMirror(md).doc.content?.[0].content?.[0];

    expect(link('[[Alice]]')).toEqual({
      type: 'entityLink',
      attrs: {
        entityId: null,
        label: 'Alice',
        descriptor: null,
        display: null,
        heading: null,
      },
    });
    expect(link('[[Alice|Al]]')?.attrs).toMatchObject({
      label: 'Alice',
      display: 'Al',
      heading: null,
    });
    expect(link('[[Alice#Bio]]')?.attrs).toMatchObject({
      label: 'Alice',
      display: null,
      heading: 'Bio',
    });
    expect(link('[[Alice#Bio|Al]]')?.attrs).toMatchObject({
      label: 'Alice',
      display: 'Al',
      heading: 'Bio',
    });
  });

  it('keeps a display alias intact even if it contains a literal "|"', () => {
    const link = (md: string) => markdownToProseMirror(md).doc.content?.[0].content?.[0];

    expect(link('[[Alice|A|B]]')?.attrs).toMatchObject({
      label: 'Alice',
      display: 'A|B',
    });
  });

  it('keeps the full heading anchor even if it contains a literal "#"', () => {
    const link = (md: string) => markdownToProseMirror(md).doc.content?.[0].content?.[0];

    expect(link('[[Alice#Head#ing]]')?.attrs).toMatchObject({
      label: 'Alice',
      heading: 'Head#ing',
    });
  });

  it('degrades an ![[embed]] to a plain link and counts it', () => {
    const { doc, degraded } = markdownToProseMirror('![[Some Note]]');

    expect(doc.content?.[0].content).toEqual([
      {
        type: 'text',
        text: 'Some Note',
        marks: [{ type: 'link', attrs: { href: 'Some Note' } }],
      },
    ]);
    expect(degraded).toEqual({ embed: 1 });
  });

  it('converts an ![[media.ext]] embed into a block image node (not a degraded link)', () => {
    const { doc, degraded } = markdownToProseMirror('![[portrait.png]]');

    // A media embed is a faithful image, so it is NOT a degraded construct.
    expect(doc.content).toEqual([{ type: 'image', attrs: { src: 'portrait.png', alt: null, title: null } }]);
    expect(degraded).toEqual({});
  });

  it('strips an ![[image|size]] embed alias, keeping the vault path as the image src', () => {
    const { doc } = markdownToProseMirror('![[folder/Map.jpg|300]]');

    expect(doc.content).toEqual([
      {
        type: 'image',
        attrs: { src: 'folder/Map.jpg', alt: null, title: null },
      },
    ]);
  });

  it('splits a paragraph so an inline ![[media]] embed becomes its own block', () => {
    const { doc } = markdownToProseMirror('see ![[cat.png]] here');

    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'see ' }] },
      { type: 'image', attrs: { src: 'cat.png', alt: null, title: null } },
      { type: 'paragraph', content: [{ type: 'text', text: ' here' }] },
    ]);
  });

  it('degrades an ![[media]] embed to a link where a block image is not allowed (heading)', () => {
    // A heading holds inline content only, so the block `image` node can't be hoisted there —
    // it degrades to a plain link rather than emitting a schema-invalid document.
    const { doc } = markdownToProseMirror('# Cover ![[cover.png]]');

    expect(doc.content).toEqual([
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [
          { type: 'text', text: 'Cover ' },
          {
            type: 'text',
            text: 'cover.png',
            marks: [{ type: 'link', attrs: { href: 'cover.png' } }],
          },
        ],
      },
    ]);
  });

  it('tallies an unrecognized block (raw HTML) as degraded instead of dropping it silently', () => {
    const { doc, degraded } = markdownToProseMirror('<div>raw</div>');

    expect(doc.content).toEqual([]);
    expect(degraded).toEqual({ html: 1 });
  });

  it('converts a heading, carrying its level as an attr', () => {
    const { doc } = markdownToProseMirror('## Chapter One');

    expect(doc.content).toEqual([
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Chapter One' }],
      },
    ]);
  });

  it('converts bullet and ordered lists into the StarterKit list nodes', () => {
    const bullet = markdownToProseMirror('- one\n- two').doc.content?.[0];
    expect(bullet).toEqual({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
        },
      ],
    });

    const ordered = markdownToProseMirror('1. first\n2. second').doc.content?.[0];
    expect(ordered?.type).toBe('orderedList');
    expect(ordered?.attrs).toEqual({ start: 1 });
  });

  it('converts a markdown link into text carrying a link mark with href', () => {
    const { doc } = markdownToProseMirror('see [the docs](https://x/docs)');

    expect(doc.content?.[0].content).toEqual([
      { type: 'text', text: 'see ' },
      {
        type: 'text',
        text: 'the docs',
        marks: [{ type: 'link', attrs: { href: 'https://x/docs' } }],
      },
    ]);
  });

  it('converts an image into a block image node with src/alt/title attrs', () => {
    const { doc } = markdownToProseMirror('![a cat](https://x/cat.png "Tabby")');

    expect(doc.content).toEqual([
      {
        type: 'image',
        attrs: { src: 'https://x/cat.png', alt: 'a cat', title: 'Tabby' },
      },
    ]);
  });

  it('splits a paragraph so an inline image becomes its own block, keeping the text', () => {
    const { doc } = markdownToProseMirror('before ![a](b.png) after');

    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'before ' }] },
      { type: 'image', attrs: { src: 'b.png', alt: 'a', title: null } },
      { type: 'paragraph', content: [{ type: 'text', text: ' after' }] },
    ]);
  });

  it('converts a GFM table with a header row into the table node set', () => {
    const md = '| A | B |\n| - | - |\n| 1 | 2 |';
    const { doc } = markdownToProseMirror(md);

    expect(doc.content?.[0]).toEqual({
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
            },
            {
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }],
            },
          ],
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }],
            },
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }],
            },
          ],
        },
      ],
    });
  });

  it('keeps a mermaid block as a fenced code block but counts it as degraded', () => {
    const { doc, degraded } = markdownToProseMirror('```mermaid\ngraph TD\n```');

    expect(doc.content?.[0]).toEqual({
      type: 'codeBlock',
      attrs: { language: 'mermaid' },
      content: [{ type: 'text', text: 'graph TD' }],
    });
    expect(degraded).toEqual({ mermaid: 1 });
  });

  it('converts a fenced code block, carrying its language', () => {
    const { doc } = markdownToProseMirror('```ts\nconst x = 1;\n```');

    expect(doc.content).toEqual([
      {
        type: 'codeBlock',
        attrs: { language: 'ts' },
        content: [{ type: 'text', text: 'const x = 1;' }],
      },
    ]);
  });

  it('converts an Obsidian callout to a callout node with type, title, and live body', () => {
    const md = '> [!warning] Be careful\n> Body with [[Alice]].';
    const { doc } = markdownToProseMirror(md);

    expect(doc.content?.[0]).toEqual({
      type: 'callout',
      attrs: { type: 'warning', title: 'Be careful' },
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Body with ' },
            {
              type: 'entityLink',
              attrs: {
                entityId: null,
                label: 'Alice',
                descriptor: null,
                display: null,
                heading: null,
              },
            },
            { type: 'text', text: '.' },
          ],
        },
      ],
    });
  });

  it('reads a callout with no title as title:null', () => {
    const { doc } = markdownToProseMirror('> [!note]\n> Just body.');
    expect(doc.content?.[0].attrs).toEqual({ type: 'note', title: null });
  });

  it('keeps a bolded callout title as plain text instead of dropping it into the body', () => {
    const { doc } = markdownToProseMirror('> [!warning] **Be careful**\n> rest of body');

    expect(doc.content?.[0].attrs).toEqual({
      type: 'warning',
      title: 'Be careful',
    });
    expect(doc.content?.[0].content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'rest of body' }] },
    ]);
  });

  it('converts a blockquote and a thematic break', () => {
    const quote = markdownToProseMirror('> quoted').doc.content?.[0];
    expect(quote).toEqual({
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }],
    });

    const rule = markdownToProseMirror('---').doc.content?.[0];
    expect(rule).toEqual({ type: 'horizontalRule' });
  });

  it('converts a GFM checklist into a taskList with per-item checked state', () => {
    const { doc } = markdownToProseMirror('- [x] done\n- [ ] todo');

    expect(doc.content?.[0]).toEqual({
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }],
        },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'todo' }] }],
        },
      ],
    });
  });

  it('splits a list mixing plain and task items so plain items stay bullets, not stray checkboxes', () => {
    // GFM allows one list to mix `-` and `- [ ]` items; PM's bulletList/taskList
    // can't mix, so each consecutive run becomes its own sibling list (#149).
    const { doc } = markdownToProseMirror('- plain one\n- plain two\n- [ ] task three\n- [x] task four');

    expect(doc.content?.map((n) => n.type)).toEqual(['bulletList', 'taskList']);
    expect(doc.content?.[0]).toEqual({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'plain one' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'plain two' }],
            },
          ],
        },
      ],
    });
    expect(doc.content?.[1].content?.map((i) => i.attrs?.['checked'])).toEqual([false, true]);
  });

  it('continues ordered numbering across a task-item split instead of restarting at the list start', () => {
    // A task item between ordered items splits the list into orderedList/taskList/orderedList.
    // The trailing plain run must keep counting (`3.`), not reset to the list's start (`1.`).
    const { doc } = markdownToProseMirror('1. plain a\n2. [ ] task b\n3. plain c');

    expect(doc.content?.map((n) => n.type)).toEqual(['orderedList', 'taskList', 'orderedList']);
    expect(doc.content?.[0].attrs?.['start']).toBe(1);
    expect(doc.content?.[2].attrs?.['start']).toBe(3);
  });

  it('keeps task-splitting per-run inside a deeply nested list, not promoting siblings (#149)', () => {
    // A nested sub-list interleaving prose bullets and `- [x]` tasks: only the two
    // tasks may become checkboxes; the plain siblings stay bullets.
    const md = [
      '- Pyramide',
      '    - Chrysée',
      '        - CA 15-',
      '        - immunité radian',
      '        - [x] gwayn au sol, 2x',
      '        - biiiim morte',
      '        - [x] Bigby au sol',
    ].join('\n');
    const { doc } = markdownToProseMirror(md);

    const taskItems: PMNode[] = [];
    const walk = (nodes?: PMNode[]) => {
      for (const n of nodes ?? []) {
        if (n.type === 'taskItem') taskItems.push(n);
        walk(n.content);
      }
    };
    walk(doc.content);

    // Exactly the two `- [x]` markers become checkboxes — nothing else.
    expect(taskItems).toHaveLength(2);
    expect(taskItems.every((t) => t.attrs?.['checked'] === true)).toBe(true);
  });

  it('does not turn a loose bullet list into checkboxes just because later items are tasks (#149)', () => {
    // A real-world Obsidian session note: prose bullets and a checklist share one
    // loose `-` list. Only the `- [ ]` items should carry checkboxes.
    const md = [
      '- Temple du vent',
      '- Go temple central',
      '',
      '- Bragear, par ton nom',
      '- [ ] Gabriel knows something',
      '- [ ] What did I discover?',
    ].join('\n');
    const { doc } = markdownToProseMirror(md);

    // The three prose bullets are one bulletList; the two tasks are one taskList.
    expect(doc.content?.map((n) => n.type)).toEqual(['bulletList', 'taskList']);
    expect(doc.content?.[0].content).toHaveLength(3);
    expect(doc.content?.[1].content).toHaveLength(2);
  });
});
