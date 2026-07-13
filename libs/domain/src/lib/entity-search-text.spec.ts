import { z } from 'zod';
import { emptyContent, EntityBody, tiptapContent } from './entity';
import { deriveSearchText } from './entity-search-text';
import { fieldSchemaSchema } from './field';
import { defineStructuredDataType, NO_STRUCTURED_DATA_TYPES, structuredDataTypeSet } from './structured-data-type';

/**
 * A stand-in for a plugin's **Structured Field** data-type: the domain bundles none of its own
 * (ADR-0050), so a spec declares one and threads it in as a host does.
 */
const BOARD = defineStructuredDataType({
  id: 'test.board',
  valueSchema: z.object({ tiles: z.array(z.object({ name: z.string() })) }),
  empty: () => ({ tiles: [] }),
  extractText: (board) => board.tiles.map((tile) => tile.name).join(' '),
});
/** A data-type with no text to give: it declares no `extractText` at all. */
const SEAL = defineStructuredDataType({
  id: 'test.seal',
  valueSchema: z.object({ colour: z.string() }),
  empty: () => ({ colour: 'red' }),
});
const DATA_TYPES = structuredDataTypeSet([BOARD, SEAL]);
const boardField = fieldSchemaSchema.parse({ key: 'board', label: 'Board', dataType: { kind: 'test.board' } });
const sealField = fieldSchemaSchema.parse({ key: 'seal', label: 'Seal', dataType: { kind: 'test.seal' } });

/** Content holding one paragraph of prose. */
const prose = (text: string) =>
  tiptapContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

/** A body whose `board` Field holds two named tiles, over the given Content. */
const board = (content = emptyContent()): EntityBody => ({
  content,
  metadata: { board: { tiles: [{ name: 'Riverbend' }, { name: 'Harbour' }] } },
});

describe('deriveSearchText (#205, ADR-0051)', () => {
  it('takes the Content prose, with no type context and no data-types in play', () => {
    const body: EntityBody = { content: prose('The obelisk hums at midnight.') };

    expect(deriveSearchText(body, [], NO_STRUCTURED_DATA_TYPES)).toBe('The obelisk hums at midnight.');
  });

  it("asks each resolved Structured Field's data-type for the text its value carries", () => {
    expect(deriveSearchText(board(), [boardField], DATA_TYPES)).toBe('Riverbend Harbour');
  });

  it('concatenates the prose and every structured contribution, single-spaced', () => {
    expect(deriveSearchText(board(prose('  A  ruined  keep. ')), [boardField], DATA_TYPES)).toBe(
      'A ruined keep. Riverbend Harbour',
    );
  });

  it('reads no structured text without the Field resolved — an Entity is its Fields, always', () => {
    // With no type context there is no `board` Field, so there is nothing to ask. The write path
    // always resolves the Entity's types.
    expect(deriveSearchText(board(), [], DATA_TYPES)).toBe('');
  });

  it('takes no text when the kind is unregistered, or the set is empty', () => {
    const typo = fieldSchemaSchema.parse({ key: 'board', label: 'Board', dataType: { kind: 'test.bord' } });

    expect(deriveSearchText(board(), [boardField], NO_STRUCTURED_DATA_TYPES)).toBe('');
    expect(deriveSearchText(board(), [typo], DATA_TYPES)).toBe('');
  });

  it('takes no text from a data-type that declares none — inert, never a throw', () => {
    const body: EntityBody = { content: emptyContent(), metadata: { seal: { colour: 'azure' } } };

    expect(deriveSearchText(body, [sealField], DATA_TYPES)).toBe('');
  });

  it('takes no text from a malformed value at rest, rather than throwing (forward-only)', () => {
    const body: EntityBody = { content: prose('Still findable.'), metadata: { board: 'garbage' } };

    expect(deriveSearchText(body, [boardField], DATA_TYPES)).toBe('Still findable.');
  });

  it('reads no prose under a Content format this build cannot parse, but still reads the Field text', () => {
    const alien = { format: 'prosemirror-v9', snapshot: { type: 'text', text: 'unreadable' } };
    const body = board(alien as unknown as EntityBody['content']);

    expect(deriveSearchText(body, [boardField], DATA_TYPES)).toBe('Riverbend Harbour');
  });
});
