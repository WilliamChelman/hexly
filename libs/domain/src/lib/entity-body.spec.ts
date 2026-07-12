import { z } from 'zod';
import { emptyEntityBody, withFieldDefaults } from './entity-body';
import { entityBodySchema } from './entity';
import { fieldSchemaSchema, resolveFields } from './field';
import { emptyHexMap } from './hex/hex-map';
import { CORE_HEXMAP_TYPE, CORE_NOTE_TYPE, CORE_STRUCTURED_DATA_TYPES } from './plugin-type';
import { defineStructuredDataType, structuredDataTypeSet } from './structured-data-type';

/** The set a host composes from the core's declarations — what the API and the web each thread in. */
const dataTypes = structuredDataTypeSet([...CORE_STRUCTURED_DATA_TYPES]);

/** Resolve a type set's Fields exactly as a host does, off the code-registered core types. */
const fieldsOf = (...types: readonly string[]) =>
  resolveFields((id) => [CORE_NOTE_TYPE, CORE_HEXMAP_TYPE].find((t) => t.id === id)?.fields, types);

const noteFields = fieldsOf(CORE_NOTE_TYPE.id);
const mapFields = fieldsOf(CORE_HEXMAP_TYPE.id);

describe('emptyEntityBody', () => {
  it('mints a blank body — Content and nothing else — for a type that declares no Fields', () => {
    const body = emptyEntityBody(noteFields, dataTypes);

    expect(entityBodySchema.parse(body)).toEqual(body);
    expect(body).toEqual({
      content: { format: 'tiptap-v3', snapshot: { type: 'doc', content: [] } },
    });
  });

  it('mints the blank body with no arguments — a caller with no type context', () => {
    expect(emptyEntityBody()).toEqual({
      content: { format: 'tiptap-v3', snapshot: { type: 'doc', content: [] } },
    });
  });

  it('opens a fresh Hex Map on a blank plane — the grid Field mints its data-type default', () => {
    // The minter knows nothing of hexes: the empty value comes from the registered data-type.
    const body = emptyEntityBody(mapFields, dataTypes);

    expect(entityBodySchema.parse(body)).toEqual(body);
    expect(body.metadata).toEqual({ grid: emptyHexMap() });
  });

  it('leaves a Structured Field unminted when the host has not registered its data-type', () => {
    // An absent plugin: the Field is inert, its value stays plain Metadata, nothing throws.
    expect(emptyEntityBody(mapFields, structuredDataTypeSet([]))).toEqual({
      content: { format: 'tiptap-v3', snapshot: { type: 'doc', content: [] } },
    });
  });
});

describe('withFieldDefaults', () => {
  const note = emptyEntityBody(noteFields, dataTypes);

  it('mints an empty grid when core.hexmap is added to an existing Note (#189)', () => {
    const reconciled = withFieldDefaults(note, mapFields, dataTypes);

    expect(reconciled.metadata).toEqual({ grid: emptyHexMap() });
    expect(entityBodySchema.parse(reconciled)).toEqual(reconciled);
    // The Content is untouched — a type change adds a Field value, it does not rebuild the body.
    expect(reconciled.content).toBe(note.content);
  });

  it("preserves the Entity's other Metadata when it mints a default", () => {
    const monster = { ...note, metadata: { armor_class: 15 } };

    expect(withFieldDefaults(monster, mapFields, dataTypes).metadata).toEqual({
      armor_class: 15,
      grid: emptyHexMap(),
    });
  });

  it('returns the same body reference when every declared Field already has a value', () => {
    const map = emptyEntityBody(mapFields, dataTypes);

    // Reference equality is what a caller's dirty check rides on — minting nothing must not
    // fabricate a new body and read as an edit.
    expect(withFieldDefaults(map, mapFields, dataTypes)).toBe(map);
    expect(withFieldDefaults(note, noteFields, dataTypes)).toBe(note);
  });

  it('never overwrites a value already at rest, however malformed — validation is forward-only', () => {
    const corrupt = { ...note, metadata: { grid: 'not-a-grid' } };

    expect(withFieldDefaults(corrupt, mapFields, dataTypes)).toBe(corrupt);
  });

  it('never strips a Field value when its type is dropped — the data outlives the lens', () => {
    const map = emptyEntityBody(mapFields, dataTypes);

    expect(withFieldDefaults(map, noteFields, dataTypes)).toBe(map);
    expect(map.metadata).toEqual({ grid: emptyHexMap() });
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

    expect(body.metadata).toEqual({ events: [] });
  });
});
