import { tiptapContent } from './entity';
import { extractOutline } from './extract-outline';

describe('extractOutline', () => {
  it('collects headings in document order', () => {
    const content = tiptapContent({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'The Reach' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'some prose' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'History' }] },
      ],
    });

    expect(extractOutline(content).map((h) => h.text)).toEqual(['The Reach', 'History']);
  });

  it('reads each heading’s level', () => {
    const content = tiptapContent({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Top' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Deep' }] },
      ],
    });

    expect(extractOutline(content)).toEqual([
      { level: 1, text: 'Top' },
      { level: 3, text: 'Deep' },
    ]);
  });

  it('concatenates a heading split across spans', () => {
    const content = tiptapContent({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [
            { type: 'text', text: 'The ' },
            { type: 'text', text: 'Whisperwood', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    });

    expect(extractOutline(content).map((h) => h.text)).toEqual(['The Whisperwood']);
  });

  it('reads an entityLink atom’s text so a mention-only heading still lists', () => {
    // Keeps this list in positional lockstep with the rendered <h*> (whose textContent
    // shows the name): skipping it here but not there jumps to the wrong heading.
    const content = tiptapContent({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'entityLink', attrs: { entityId: 'x', label: 'Lady Mara', display: 'Mara' } }],
        },
      ],
    });

    expect(extractOutline(content).map((h) => h.text)).toEqual(['Mara']); // display wins over label
  });

  it('skips a heading with no text — nothing to navigate to', () => {
    const content = tiptapContent({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Real' }] },
        { type: 'heading', attrs: { level: 2 } }, // empty line the author just made a heading
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '   ' }] }, // whitespace only
      ],
    });

    expect(extractOutline(content).map((h) => h.text)).toEqual(['Real']);
  });

  it('returns [] for an unknown/future format tag', () => {
    // A foreign snapshot may reuse the word "heading" for something else — don't parse it.
    const content = {
      format: 'prosemirror-v9',
      snapshot: { type: 'heading', content: [{ type: 'text', text: 'ignored' }] },
    } as never;

    expect(extractOutline(content)).toEqual([]);
  });
});
