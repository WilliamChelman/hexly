import { z } from 'zod';
import { emptyEntityDocument, withFieldDefaults } from './entity-document';
import { entityDocumentSchema } from './entity';
import { fieldSchemaSchema } from './field';
import { defineStructuredDataType, structuredDataTypeSet } from './structured-data-type';

/** A stand-in for a plugin's Structured Data Type — the domain bundles none of its own. */
const BOARD = defineStructuredDataType({
  id: 'test.board',
  valueSchema: z.object({ tiles: z.record(z.string(), z.string()) }),
  empty: () => ({ tiles: {} }),
});
const emptyBoard = () => BOARD.empty();

/** The set a host composes from what it bundles — what the API and the web each thread in. */
const dataTypes = structuredDataTypeSet([BOARD]);

const BOARD_FIELD = fieldSchemaSchema.parse({ key: 'board', label: 'Board', dataType: { kind: BOARD.id } });

/** The resolved effective Field sets a host threads in — a bodyless type declares none; an atlas its grid. */
const plainFields: ReturnType<typeof fieldSchemaSchema.parse>[] = [];
const atlasFields = [BOARD_FIELD];

describe('emptyEntityDocument', () => {
  it('mints the empty map for a type that declares no Fields', () => {
    const body = emptyEntityDocument(plainFields, dataTypes);

    expect(entityDocumentSchema.parse(body)).toEqual(body);
    expect(body).toEqual({});
  });

  it('mints the empty map with no arguments — a caller with no type context', () => {
    expect(emptyEntityDocument()).toEqual({});
  });

  it("opens a fresh Field of a Structured Data Type on its data-type's empty value, at its own key", () => {
    // The minter knows nothing of what the value holds: the default comes from the registered
    // data-type. A fresh map opens on a blank plane this way — and prose on an empty document.
    const body = emptyEntityDocument(atlasFields, dataTypes);

    expect(entityDocumentSchema.parse(body)).toEqual(body);
    expect(body).toEqual({ board: emptyBoard() });
  });

  it('leaves a Field of a Structured Data Type unminted when the host has not registered it', () => {
    // An absent plugin: the Field is inert, its value stays plain EntityDocument, nothing throws.
    expect(emptyEntityDocument(atlasFields, structuredDataTypeSet([]))).toEqual({});
  });
});

describe('withFieldDefaults', () => {
  it('mints the empty value when a type declaring a Field of a Structured Data Type is added (#189)', () => {
    const reconciled = withFieldDefaults({}, atlasFields, dataTypes);

    expect(reconciled).toEqual({ board: emptyBoard() });
    expect(entityDocumentSchema.parse(reconciled)).toEqual(reconciled);
  });

  it("preserves the Entity's other EntityDocument when it mints a default", () => {
    const monster = { armor_class: 15 };

    expect(withFieldDefaults(monster, atlasFields, dataTypes)).toEqual({
      armor_class: 15,
      board: emptyBoard(),
    });
  });

  it('returns the same body reference when every declared Field already has a value', () => {
    const atlas = emptyEntityDocument(atlasFields, dataTypes);

    // Reference equality is what a caller's dirty check rides on — minting nothing must not
    // fabricate a new body and read as an edit.
    expect(withFieldDefaults(atlas, atlasFields, dataTypes)).toBe(atlas);
    expect(withFieldDefaults({}, plainFields, dataTypes)).toEqual({});
  });

  it('never overwrites a value already at rest, however malformed — validation is forward-only', () => {
    const corrupt = { board: 'not-a-board' };

    expect(withFieldDefaults(corrupt, atlasFields, dataTypes)).toBe(corrupt);
  });

  it('never strips a Field value when its type is dropped — the data outlives the lens', () => {
    const atlas = emptyEntityDocument(atlasFields, dataTypes);

    expect(withFieldDefaults(atlas, plainFields, dataTypes)).toBe(atlas);
    expect(atlas).toEqual({ board: emptyBoard() });
  });

  it("mints a data-type whose empty value is itself empty — a blank timeline's []", () => {
    // The EntityDocument writer clears a key whose value reads as emptied, so minting must not go through
    // it: a plugin whose `empty()` is `[]` still gets its default.
    const timeline = defineStructuredDataType({
      id: 'test.timeline',
      valueSchema: z.array(z.object({ at: z.string() })),
      empty: () => [],
    });
    const events = fieldSchemaSchema.parse({
      key: 'events',
      label: 'Events',
      dataType: { kind: 'test.timeline' },
    });

    const body = emptyEntityDocument([events], structuredDataTypeSet([timeline]));

    expect(body).toEqual({ events: [] });
  });
});
