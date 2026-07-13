import { z } from 'zod';
import { emptyEntityBody, withFieldDefaults } from './entity-body';
import { entityBodySchema } from './entity';
import { fieldSchemaSchema, resolveFields } from './field';
import { defineType } from './plugin-type';
import { defineStructuredDataType, structuredDataTypeSet } from './structured-data-type';

/** A stand-in for a plugin's Structured Field data-type — the domain bundles none of its own. */
const BOARD = defineStructuredDataType({
  id: 'test.board',
  valueSchema: z.object({ tiles: z.record(z.string(), z.string()) }),
  empty: () => ({ tiles: {} }),
});
const emptyBoard = () => BOARD.empty();

/** The set a host composes from what it bundles — what the API and the web each thread in. */
const dataTypes = structuredDataTypeSet([BOARD]);

const BOARD_FIELD = fieldSchemaSchema.parse({ key: 'board', label: 'Board', dataType: { kind: BOARD.id } });
/** A plugin type that declares no Fields — a bodyless Note, before any prose plugin joins. */
const PLAIN_TYPE = defineType({ id: 'test.plain', label: 'Plain' });
/** A plugin type whose one Field is that structured value — the shape the Map plugin's type has. */
const ATLAS_TYPE = defineType({ id: 'test.atlas', label: 'Atlas', fields: [BOARD_FIELD] });

/** Resolve a type set's Fields exactly as a host does, off its registered types. */
const fieldsOf = (...types: readonly string[]) =>
  resolveFields((id) => [PLAIN_TYPE, ATLAS_TYPE].find((t) => t.id === id)?.fields, types);

const plainFields = fieldsOf(PLAIN_TYPE.id);
const atlasFields = fieldsOf(ATLAS_TYPE.id);

describe('emptyEntityBody', () => {
  it('mints the empty map for a type that declares no Fields', () => {
    const body = emptyEntityBody(plainFields, dataTypes);

    expect(entityBodySchema.parse(body)).toEqual(body);
    expect(body).toEqual({});
  });

  it('mints the empty map with no arguments — a caller with no type context', () => {
    expect(emptyEntityBody()).toEqual({});
  });

  it("opens a fresh Structured Field on its data-type's empty value, at its own key", () => {
    // The minter knows nothing of what the value holds: the default comes from the registered
    // data-type. A fresh map opens on a blank plane this way — and prose on an empty document.
    const body = emptyEntityBody(atlasFields, dataTypes);

    expect(entityBodySchema.parse(body)).toEqual(body);
    expect(body).toEqual({ board: emptyBoard() });
  });

  it('leaves a Structured Field unminted when the host has not registered its data-type', () => {
    // An absent plugin: the Field is inert, its value stays plain Metadata, nothing throws.
    expect(emptyEntityBody(atlasFields, structuredDataTypeSet([]))).toEqual({});
  });
});

describe('withFieldDefaults', () => {
  it('mints the empty value when a type declaring a Structured Field is added (#189)', () => {
    const reconciled = withFieldDefaults({}, atlasFields, dataTypes);

    expect(reconciled).toEqual({ board: emptyBoard() });
    expect(entityBodySchema.parse(reconciled)).toEqual(reconciled);
  });

  it("preserves the Entity's other Metadata when it mints a default", () => {
    const monster = { armor_class: 15 };

    expect(withFieldDefaults(monster, atlasFields, dataTypes)).toEqual({
      armor_class: 15,
      board: emptyBoard(),
    });
  });

  it('returns the same body reference when every declared Field already has a value', () => {
    const atlas = emptyEntityBody(atlasFields, dataTypes);

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
    const atlas = emptyEntityBody(atlasFields, dataTypes);

    expect(withFieldDefaults(atlas, plainFields, dataTypes)).toBe(atlas);
    expect(atlas).toEqual({ board: emptyBoard() });
  });

  it("mints a data-type whose empty value is itself empty — a blank timeline's []", () => {
    // The Metadata writer clears a key whose value reads as emptied, so minting must not go through
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

    const body = emptyEntityBody([events], structuredDataTypeSet([timeline]));

    expect(body).toEqual({ events: [] });
  });
});
