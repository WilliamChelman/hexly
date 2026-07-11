import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ActiveWorld, WorldsClient } from '@hexly/web-core';
import { AvailableType } from '@hexly/domain';
import { WorldTypesLoader } from './world-types-loader';
import { TypeRegistry } from './type-registry';
import { CORE_VIEW_FIELDS } from './view-definition';

/**
 * The loader projects the active World's user-defined types into the root {@link TypeRegistry} and
 * swaps the set on a World change, so every type-aware surface resolves a World's own types without
 * a second source — and one World's types never leak into another (#191).
 */
describe('WorldTypesLoader', () => {
  const deity: AvailableType = {
    id: 'world.deity',
    label: 'Deity',
    source: 'user',
    fields: [{ key: 'domain', label: 'Domain', dataType: { kind: 'string' }, required: false, facetable: true }],
  };
  const monster: AvailableType = { id: 'dnd.monster', label: 'Monster', source: 'plugin', fields: [] };

  let worldId: ReturnType<typeof signal<string | null>>;
  let availableTypes: ReturnType<typeof vi.fn>;
  let registry: TypeRegistry;

  beforeEach(() => {
    worldId = signal<string | null>(null);
    availableTypes = vi.fn(() => of<AvailableType[]>([]));
    TestBed.configureTestingModule({
      providers: [
        { provide: ActiveWorld, useValue: { worldId } },
        { provide: WorldsClient, useValue: { availableTypes } },
      ],
    });
    registry = TestBed.inject(TypeRegistry);
    TestBed.inject(WorldTypesLoader); // instantiate the reactive singleton
    TestBed.flushEffects(); // flush the initial `null` world emission
  });

  it('registers a user-defined type as a generic-Field-View definition when the World loads', () => {
    availableTypes.mockReturnValue(of([monster, deity]));
    worldId.set('w1');
    TestBed.flushEffects();

    const def = registry.get('world.deity');
    expect(def?.labelText).toBe('Deity');
    // A user-defined type's only View is the generic Field View, so an Entity carrying it renders.
    expect(def?.views).toEqual([CORE_VIEW_FIELDS]);
    // Its Fields resolve, so the generic view and facets pick them up.
    expect(registry.resolveFields(['world.deity']).map((f) => f.key)).toEqual(['domain']);
  });

  it('never registers a plugin-source type — those register in code', () => {
    availableTypes.mockReturnValue(of([monster]));
    worldId.set('w1');
    TestBed.flushEffects();

    expect(registry.get('dnd.monster')).toBeUndefined();
  });

  it('drops the previous World’s user types on a World change (no cross-World leak)', () => {
    availableTypes.mockReturnValue(of([deity]));
    worldId.set('w1');
    TestBed.flushEffects();
    expect(registry.get('world.deity')).toBeTruthy();

    availableTypes.mockReturnValue(of<AvailableType[]>([]));
    worldId.set('w2');
    TestBed.flushEffects();
    expect(registry.get('world.deity')).toBeUndefined();
  });
});
