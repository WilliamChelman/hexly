import { visit } from './content-node';
import { entityLinkText } from './entity-link';

describe('visit', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [
          { type: 'text', text: 'b' },
          { type: 'entityLink', attrs: { label: 'Town' } },
        ],
      },
    ],
  };

  it('yields every node in pre-order', () => {
    const types: string[] = [];
    visit(doc, (n) => types.push(n.type));
    expect(types).toEqual(['doc', 'paragraph', 'text', 'heading', 'text', 'entityLink']);
  });

  it('lets a reader accumulate and a rewriter mutate in place', () => {
    visit(doc, (n) => {
      if (n.type === 'entityLink' && n.attrs) n.attrs['entityId'] = 'e1';
    });
    const ids: unknown[] = [];
    visit(doc, (n) => n.type === 'entityLink' && ids.push(n.attrs?.['entityId']));
    expect(ids).toEqual(['e1']);
  });

  it('no-ops on a non-object snapshot', () => {
    const seen: unknown[] = [];
    visit(undefined, (n) => seen.push(n));
    visit('nope', (n) => seen.push(n));
    expect(seen).toEqual([]);
  });

  it('accepts a bare array of nodes', () => {
    const types: string[] = [];
    visit(
      [
        { type: 'text', text: 'x' },
        { type: 'text', text: 'y' },
      ],
      (n) => types.push(n.type),
    );
    expect(types).toEqual(['text', 'text']);
  });
});

describe('entityLinkText', () => {
  it('prefers display over label', () => {
    expect(entityLinkText({ display: 'shown', label: 'stored' })).toBe('shown');
  });
  it('falls back to label when display is null', () => {
    expect(entityLinkText({ display: null, label: 'stored' })).toBe('stored');
  });
  it('is empty when neither is a string', () => {
    expect(entityLinkText({ display: null, label: null })).toBe('');
    expect(entityLinkText(undefined)).toBe('');
  });
});
