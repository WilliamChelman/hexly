import { TestBed } from '@angular/core/testing';
import { TypeRegistry } from './type-registry';
import { TypeDefinition } from './type-definition';

function definition(id: string): TypeDefinition {
  return {
    id: id as TypeDefinition['id'],
    icon: 'label',
    surfaces: ['note'],
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

  it('reports whether a type set affords the map surface — any member with the payload counts', () => {
    expect(registry.affordsMap(['core.hexmap'])).toBe(true);
    expect(registry.affordsMap(['core.note'])).toBe(false);
    // A multi-type set affords the map if any member does (a future `[dnd.monster, core.hexmap]`).
    expect(registry.affordsMap(['dnd.monster', 'core.hexmap'])).toBe(true);
    expect(registry.affordsMap([])).toBe(false);
    expect(registry.affordsMap(undefined)).toBe(false);
  });

  it('lists the map-affording type ids for the maps filter', () => {
    expect(registry.mapTypeIds()).toEqual(['core.hexmap']);
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
