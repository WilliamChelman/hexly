import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ActiveWorld, WorldsClient } from '@hexly/web-core';
import { AvailableType, FieldSchema } from '@hexly/domain';
import { WorldTypesLoader } from './world-types-loader';
import { TypeRegistry } from './type-registry';
import { CORE_VIEW_CONTENT, CORE_VIEW_FIELDS } from '@hexly/web-entity';

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
  // A plugin-source type as the API reports it. The web already knows its plugin types from code, so
  // the loader must ignore these rows rather than re-register a view-less copy over the real one.
  const monster: AvailableType = { id: 'test.monster', label: 'Monster', source: 'plugin', fields: [] };
  /** A World Owner's own **Structured Field**: a grid on the type they defined, no code (#201). */
  const battlemapField: FieldSchema = {
    key: 'battlemap',
    label: 'Battlemap',
    dataType: { kind: 'core.hex-grid' },
    required: false,
    facetable: false,
  };

  let worldId: ReturnType<typeof signal<string | null>>;
  let availableTypes: ReturnType<typeof vi.fn>;
  let registry: TypeRegistry;

  beforeEach(() => {
    worldId = signal<string | null>(null);
    availableTypes = vi.fn(() => of<AvailableType[]>([]));
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
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
    // No authored order: the type falls back to its Fields, then its Content (#201). Fields first,
    // so an Entity carrying it opens on the values its author gave it.
    expect(def?.views).toEqual([CORE_VIEW_FIELDS, CORE_VIEW_CONTENT]);
    // Its Fields resolve, so the generic view and facets pick them up.
    expect(registry.resolveFields(['world.deity']).map((f) => f.key)).toEqual(['domain']);
  });

  it('defaults a Structured Field’s View to *last*, so a deity with a battlemap still opens on its Fields', () => {
    availableTypes.mockReturnValue(of([{ ...deity, fields: [...deity.fields, battlemapField] }]));
    worldId.set('w1');
    TestBed.flushEffects();

    expect(registry.get('world.deity')?.views).toEqual([CORE_VIEW_FIELDS, CORE_VIEW_CONTENT, { field: 'battlemap' }]);
  });

  it('projects the author’s own View order verbatim, so "Show as a view" can drop one', () => {
    // The editor's toggle, off: the `battlemap` Field keeps its value and its place in the form, but
    // places no View — so the Entity affords no map toggle for it.
    availableTypes.mockReturnValue(
      of([{ ...deity, fields: [battlemapField], views: [CORE_VIEW_FIELDS, CORE_VIEW_CONTENT] }]),
    );
    worldId.set('w1');
    TestBed.flushEffects();

    expect(registry.get('world.deity')?.views).toEqual([CORE_VIEW_FIELDS, CORE_VIEW_CONTENT]);
  });

  it('never registers a plugin-source type — those register in code', () => {
    availableTypes.mockReturnValue(of([monster]));
    worldId.set('w1');
    TestBed.flushEffects();

    expect(registry.get('test.monster')).toBeUndefined();
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
