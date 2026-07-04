import { tiptapContent } from './entity';
import { harvestDescriptors } from './harvest-descriptors';

/** A doc holding the given entityLink attrs, wrapped in a paragraph. */
function docWith(...links: Record<string, unknown>[]) {
  return tiptapContent({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: links.map((attrs) => ({ type: 'entityLink', attrs })),
      },
    ],
  });
}

describe('harvestDescriptors (#96, ADR-0023)', () => {
  it('collects the descriptor set on entityLink nodes', () => {
    const content = docWith(
      { entityId: 'e1', descriptor: 'spouse' },
      { entityId: 'e2', descriptor: 'capital of' },
    );
    expect(harvestDescriptors(content).sort()).toEqual(['capital of', 'spouse']);
  });

  it('dedups the same descriptor used on multiple links', () => {
    const content = docWith(
      { entityId: 'e1', descriptor: 'rival' },
      { entityId: 'e2', descriptor: 'rival' },
    );
    expect(harvestDescriptors(content)).toEqual(['rival']);
  });

  it('skips links with no descriptor, blank descriptors, and empty docs', () => {
    expect(harvestDescriptors(docWith({ entityId: 'e1' }))).toEqual([]);
    expect(harvestDescriptors(docWith({ entityId: 'e1', descriptor: '  ' }))).toEqual([]);
    expect(harvestDescriptors(tiptapContent({ type: 'doc', content: [] }))).toEqual([]);
  });

  it('finds descriptors on links nested deep in the tree', () => {
    const content = tiptapContent({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'entityLink', attrs: { entityId: 'e1', descriptor: 'liege' } }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(harvestDescriptors(content)).toEqual(['liege']);
  });

  it('returns nothing for an unknown/future format tag', () => {
    const content = { format: 'prosemirror-v9', snapshot: { type: 'entityLink', attrs: { descriptor: 'x' } } } as never;
    expect(harvestDescriptors(content)).toEqual([]);
  });
});
