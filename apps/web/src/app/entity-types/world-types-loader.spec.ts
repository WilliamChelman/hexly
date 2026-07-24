import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ActiveWorld, WorldsClient } from '@hexly/web-core';
import { AvailableType, defineField } from '@hexly/domain';
import { WorldTypesLoader } from './world-types-loader';
import { TypeRegistry } from './type-registry';
import { CORE_VIEW_RICH_CONTENT } from '@hexly/plugin-content/web';

describe('WorldTypesLoader', () => {
  // A World's own Fields, resolved through the registry by the ids a type references (ADR-0054).
  const domainField = defineField({
    id: 'world.field.domain',
    label: 'Domain',
    dataType: { kind: 'string' },
    facetable: true,
  });
  /** A World Owner's own **Field of a Structured Data Type**: a grid on the type they defined, no code (#201). */
  const battlemapField = defineField({
    id: 'world.field.battle-map',
    label: 'Battlemap',
    dataType: { kind: 'core.datatype.hex-grid' },
  });

  const deity: AvailableType = {
    id: 'world.type.deity',
    label: 'Deity',
    source: 'user',
    fieldRefs: ['world.field.domain'],
  };
  // A plugin-source type as the API reports it. The web already knows its plugin types from code, so
  // the loader must ignore these rows rather than re-register a view-less copy over the real one.
  const monster: AvailableType = { id: 'test.type.monster', label: 'Monster', source: 'plugin', fieldRefs: [] };

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
    // The World's Fields resolve by id (ADR-0054) — projected by WorldFieldsLoader in prod; set here
    // directly so a type's `fieldRefs` resolve when the types loader projects.
    registry.setWorldFields([domainField, battlemapField]);
    TestBed.inject(WorldTypesLoader); // instantiate the reactive singleton
    TestBed.flushEffects(); // flush the initial `null` world emission
  });

  it('registers a user-defined type placing no View when the World loads — it falls to the Details View', () => {
    availableTypes.mockReturnValue(of([monster, deity]));
    worldId.set('w1');
    TestBed.flushEffects();

    const def = registry.get('world.type.deity');
    expect(def?.labelText).toBe('Deity');
    // No authored order, and no structured Field: the type places no View at all (ADR-0067), so it falls
    // to the fallback Details View in `viewsFor`. Prose is a Field of a Structured Data Type now, so a
    // deity gets a content View only when it declares one.
    expect(def?.views).toEqual([]);
    // Its Fields resolve, so the Details View and facets pick them up.
    expect(registry.resolveFields(['world.type.deity']).map((f) => f.id)).toEqual(['world.field.domain']);
  });

  it('places a Field of a Structured Data Type’s View, so a deity with a battlemap opens on it (ADR-0067)', () => {
    availableTypes.mockReturnValue(of([{ ...deity, fieldRefs: ['world.field.domain', 'world.field.battle-map'] }]));
    worldId.set('w1');
    TestBed.flushEffects();

    // Only the structured Field places a View now — the Details View is never placed, it is the fallback.
    expect(registry.get('world.type.deity')?.views).toEqual([{ field: 'world.field.battle-map' }]);
  });

  it('projects the author’s own View order verbatim, so "Show as a view" can drop one', () => {
    // The toggle, off: the `battlemap` Field is still referenced, but places no View — the author's list
    // carries a content View alone, and the loader passes it through untouched.
    availableTypes.mockReturnValue(
      of([{ ...deity, fieldRefs: ['world.field.battle-map'], views: [CORE_VIEW_RICH_CONTENT] }]),
    );
    worldId.set('w1');
    TestBed.flushEffects();

    expect(registry.get('world.type.deity')?.views).toEqual([CORE_VIEW_RICH_CONTENT]);
  });

  it('never registers a plugin-source type — those register in code', () => {
    availableTypes.mockReturnValue(of([monster]));
    worldId.set('w1');
    TestBed.flushEffects();

    expect(registry.get('test.type.monster')).toBeUndefined();
  });

  it('drops the previous World’s user types on a World change (no cross-World leak)', () => {
    availableTypes.mockReturnValue(of([deity]));
    worldId.set('w1');
    TestBed.flushEffects();
    expect(registry.get('world.type.deity')).toBeTruthy();

    availableTypes.mockReturnValue(of<AvailableType[]>([]));
    worldId.set('w2');
    TestBed.flushEffects();
    expect(registry.get('world.type.deity')).toBeUndefined();
  });
});
