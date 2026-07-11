import { TestBed } from '@angular/core/testing';
import { FieldSchema } from '@hexly/domain';
import { TypeRegistry } from './type-registry';
import { TypeDefinition } from './type-definition';
import { CORE_VIEW_CONTENT, CORE_VIEW_FIELDS, CORE_VIEW_MAP } from './view-definition';

function definition(id: string, fields?: readonly FieldSchema[]): TypeDefinition {
  return {
    id: id as TypeDefinition['id'],
    icon: 'label',
    views: [CORE_VIEW_CONTENT],
    fields,
    graphColorToken: '--color-ink-muted',
    labels: {
      eyebrow: `${id}.eyebrow`,
      titleLabel: `${id}.titleLabel`,
      rename: `${id}.rename`,
      editorLabel: `${id}.editorLabel`,
      create: `${id}.create`,
      untitled: `${id}.untitled`,
    },
  };
}

const crField: FieldSchema = {
  key: 'cr',
  label: 'Challenge Rating',
  dataType: { kind: 'number' },
  required: false,
  facetable: false,
};

describe('TypeRegistry', () => {
  let registry: TypeRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(TypeRegistry);
  });

  it('seeds the core note and hexmap types (core dogfoods register())', () => {
    expect(registry.all().map((d) => d.id)).toEqual(['core.note', 'core.hexmap']);
  });

  it('resolves a registered definition by its type id', () => {
    expect(registry.get('core.hexmap')?.icon).toBe('terrain');
    expect(registry.get('core.note')?.icon).toBe('label');
  });

  it('returns undefined for an unregistered or absent type', () => {
    expect(registry.get('dnd.monster')).toBeUndefined();
    expect(registry.get(null)).toBeUndefined();
    expect(registry.get(undefined)).toBeUndefined();
  });

  it('resolves an unregistered or absent type to the core note fallback', () => {
    expect(registry.resolve('core.hexmap').id).toBe('core.hexmap');
    expect(registry.resolve('dnd.monster').id).toBe('core.note');
    expect(registry.resolve(undefined).id).toBe('core.note');
  });

  it('unions the ordered Views a type set affords — primary first, deduped', () => {
    expect(registry.viewsFor(['core.hexmap'])).toEqual([CORE_VIEW_MAP, CORE_VIEW_CONTENT]);
    expect(registry.viewsFor(['core.note'])).toEqual([CORE_VIEW_CONTENT]);
    // A multi-type set unions in `types` order, deduping the shared content view.
    expect(registry.viewsFor(['core.hexmap', 'core.note'])).toEqual([CORE_VIEW_MAP, CORE_VIEW_CONTENT]);
    expect(registry.viewsFor([])).toEqual([]);
    expect(registry.viewsFor(undefined)).toEqual([]);
  });

  it('affords the generic Field View for a type that declares Fields (ADR-0048)', () => {
    registry.register(definition('dnd.beast', [crField]));
    // The declared-Field type unions its own views plus the generic Field View.
    expect(registry.viewsFor(['dnd.beast'])).toEqual([CORE_VIEW_CONTENT, CORE_VIEW_FIELDS]);
    // A core type declares no Fields, so it never surfaces the generic View.
    expect(registry.viewsFor(['core.note'])).toEqual([CORE_VIEW_CONTENT]);
  });

  it('falls back to the generic Field View for an unregistered type — the missing-plugin case', () => {
    // No definition registered for `dnd.monster`: the Entity still affords the generic View, which
    // renders it as an inert chip over its plain Metadata rather than a blank screen.
    expect(registry.viewsFor(['dnd.monster'])).toEqual([CORE_VIEW_FIELDS]);
  });

  it('resolves the union of Field schemas a types[] set declares, primary type first', () => {
    registry.register(definition('dnd.beast', [crField]));
    expect(registry.resolveFields(['dnd.beast']).map((f) => f.key)).toEqual(['cr']);
    // A set of types that declare no Fields resolves to none — values stay plain Metadata.
    expect(registry.resolveFields(['core.note'])).toEqual([]);
    expect(registry.resolveFields(undefined)).toEqual([]);
  });

  it('lists the type ids contributing a View — backing the maps filter', () => {
    expect(registry.typeIdsForView(CORE_VIEW_MAP)).toEqual(['core.hexmap']);
    expect(registry.typeIdsForView(CORE_VIEW_CONTENT)).toEqual(['core.note', 'core.hexmap']);
  });

  it('registers a new definition and drops it via the returned unregister fn', () => {
    const def = definition('dnd.monster');
    const unregister = registry.register(def);

    expect(registry.get('dnd.monster')).toBe(def);
    unregister();
    expect(registry.get('dnd.monster')).toBeUndefined();
  });

  it('keeps definitions in registration order (core first)', () => {
    registry.register(definition('dnd.monster'));
    expect(registry.all().map((d) => d.id)).toEqual(['core.note', 'core.hexmap', 'dnd.monster']);
  });
});
