import { z } from 'zod';
import { Metadata } from './field';
import { deriveSearchText } from './derive-search-text';
import { fieldSchemaSchema } from './field';
import { defineStructuredDataType, NO_STRUCTURED_DATA_TYPES, structuredDataTypeSet } from './structured-data-type';

/**
 * Stand-ins for a plugin's **Structured Field** data-types: the domain bundles none of its own
 * (ADR-0050), so a spec declares them and threads them in as a host does. `PROSE` stands for
 * `core.rich-content`, which contributes a document's text through this same generic path (ADR-0051).
 */
const PROSE = defineStructuredDataType({
  id: 'test.prose',
  valueSchema: z.object({ text: z.string() }),
  empty: () => ({ text: '' }),
  extractText: (prose) => prose.text,
});
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
const DATA_TYPES = structuredDataTypeSet([PROSE, BOARD, SEAL]);
const proseField = fieldSchemaSchema.parse({ key: 'prose', label: 'Prose', dataType: { kind: 'test.prose' } });
const boardField = fieldSchemaSchema.parse({ key: 'board', label: 'Board', dataType: { kind: 'test.board' } });
const sealField = fieldSchemaSchema.parse({ key: 'seal', label: 'Seal', dataType: { kind: 'test.seal' } });

/** A body whose `board` Field holds two named tiles. */
const board = (extra: Metadata = {}): Metadata => ({
  board: { tiles: [{ name: 'Riverbend' }, { name: 'Harbour' }] },
  ...extra,
});

describe('deriveSearchText (#205, ADR-0051)', () => {
  it('is empty with no type context and no data-types in play', () => {
    expect(deriveSearchText({ prose: { text: 'unseen' } }, [], NO_STRUCTURED_DATA_TYPES)).toBe('');
  });

  it("asks each resolved Structured Field's data-type for the text its value carries", () => {
    expect(deriveSearchText(board(), [boardField], DATA_TYPES)).toBe('Riverbend Harbour');
  });

  it('concatenates every structured contribution, single-spaced', () => {
    const body = board({ prose: { text: 'A ruined keep.' } });
    expect(deriveSearchText(body, [proseField, boardField], DATA_TYPES)).toBe('A ruined keep. Riverbend Harbour');
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
    expect(deriveSearchText({ seal: { colour: 'azure' } }, [sealField], DATA_TYPES)).toBe('');
  });

  it('takes no text from a malformed value at rest, rather than throwing (forward-only)', () => {
    const body: Metadata = { prose: { text: 'Still findable.' }, board: 'garbage' };

    expect(deriveSearchText(body, [proseField, boardField], DATA_TYPES)).toBe('Still findable.');
  });
});
