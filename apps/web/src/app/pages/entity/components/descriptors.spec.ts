import { Editor, JSONContent } from '@tiptap/core';
import { CONTENT_EXTENSIONS } from './content-extensions';
import {
  descriptorItems,
  entityLinkPosBefore,
  harvestDescriptors,
  setLinkDescriptor,
} from './descriptors';

function freshEditor() {
  return new Editor({ extensions: CONTENT_EXTENSIONS });
}

function linkAttrs(editor: Editor): JSONContent['attrs'] {
  const json: JSONContent = editor.getJSON();
  return json.content?.[0]?.content?.find((n) => n.type === 'entityLink')?.attrs;
}

function docWith(...links: Array<{ name: string; descriptor?: string }>): JSONContent {
  const editor = new Editor({ extensions: CONTENT_EXTENSIONS });
  for (const { name, descriptor } of links) {
    editor.commands.insertEntityLink({
      entityId: 'e-' + name,
      label: name,
      descriptor: descriptor ?? null,
    });
  }
  const json = editor.getJSON();
  editor.destroy();
  return json;
}

describe('harvestDescriptors', () => {
  it('collects the distinct descriptors set on entityLinks (#96)', () => {
    const doc = docWith(
      { name: 'Jane', descriptor: 'spouse' },
      { name: 'Acme', descriptor: 'capital of' },
    );
    expect(harvestDescriptors(doc).sort()).toEqual(['capital of', 'spouse']);
  });

  it('de-duplicates a descriptor used on several links', () => {
    const doc = docWith(
      { name: 'Jane', descriptor: 'spouse' },
      { name: 'John', descriptor: 'spouse' },
    );
    expect(harvestDescriptors(doc)).toEqual(['spouse']);
  });

  it('ignores links with no descriptor, and a doc with no links', () => {
    expect(harvestDescriptors(docWith({ name: 'Jane' }))).toEqual([]);
    expect(harvestDescriptors({ type: 'doc', content: [] })).toEqual([]);
  });
});

describe('entityLinkPosBefore — the `::` arm predicate (#96)', () => {
  it('finds the link position when an entityLink sits immediately before the cursor', () => {
    const editor = freshEditor();
    editor.commands.insertEntityLink({ entityId: 'e1', label: 'Jane' });
    const pos = entityLinkPosBefore(editor.state, editor.state.selection.from);
    editor.destroy();

    // Inline atom inserted at doc position 1, so its node starts at 1.
    expect(pos).toBe(1);
  });

  it('returns null in plain prose — `::` is then literal text', () => {
    const editor = freshEditor();
    editor.commands.insertContent('just some words');
    const pos = entityLinkPosBefore(editor.state, editor.state.selection.from);
    editor.destroy();

    expect(pos).toBeNull();
  });

  it('returns null once a character separates the cursor from the link', () => {
    const editor = freshEditor();
    editor.commands.insertEntityLink({ entityId: 'e1', label: 'Jane' });
    editor.commands.insertContent(' '); // a space now sits between link and cursor
    const pos = entityLinkPosBefore(editor.state, editor.state.selection.from);
    editor.destroy();

    expect(pos).toBeNull();
  });
});

describe('setLinkDescriptor — set/change/clear (#96)', () => {
  let editor: Editor;
  afterEach(() => editor.destroy());

  it('sets the descriptor on the link at the given position', () => {
    editor = freshEditor();
    editor.commands.insertEntityLink({ entityId: 'e1', label: 'Jane' });
    setLinkDescriptor(editor, 1, 'spouse');

    expect(linkAttrs(editor)?.['descriptor']).toBe('spouse');
  });

  it('changes an already-set descriptor when applied again', () => {
    editor = freshEditor();
    editor.commands.insertEntityLink({
      entityId: 'e1',
      label: 'Jane',
      descriptor: 'spouse',
    });
    setLinkDescriptor(editor, 1, 'rival');

    expect(linkAttrs(editor)?.['descriptor']).toBe('rival');
  });

  it('clears the descriptor when applied with empty/blank text', () => {
    editor = freshEditor();
    editor.commands.insertEntityLink({
      entityId: 'e1',
      label: 'Jane',
      descriptor: 'spouse',
    });
    setLinkDescriptor(editor, 1, '   ');

    expect(linkAttrs(editor)?.['descriptor'] ?? null).toBeNull();
  });
});

describe('descriptorItems — `::` suggestions + free text (#96)', () => {
  const vocab = ['capital of', 'rival', 'spouse'];

  it('filters the owner vocabulary by a case-insensitive substring', () => {
    const matches = descriptorItems('iv', vocab).filter((i) => !i.isNew);
    expect(matches.map((i) => i.descriptor)).toEqual(['rival']);
  });

  it('offers the typed text as a brand-new descriptor when it matches nothing', () => {
    const items = descriptorItems('mentor', vocab);
    // Free text, never boxed in: the typed value leads as a new entry.
    expect(items[0]).toEqual({ id: expect.any(String), descriptor: 'mentor', isNew: true });
  });

  it('does not duplicate an existing descriptor as a "new" entry (case-folded)', () => {
    const items = descriptorItems('Spouse', vocab);
    expect(items.filter((i) => i.isNew)).toEqual([]);
    expect(items.map((i) => i.descriptor)).toEqual(['spouse']);
  });

  it('lists the whole vocabulary and offers no new entry for an empty query', () => {
    const items = descriptorItems('   ', vocab);
    expect(items.every((i) => !i.isNew)).toBe(true);
    expect(items.map((i) => i.descriptor)).toEqual(vocab);
  });
});
