import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ActiveWorld, WorldsClient } from '@hexly/web-core';
import { AvailableType, defineField } from '@hexly/domain';
import { WorldTypesLoader } from './world-types-loader';
import { TypeRegistry } from './type-registry';
import { CORE_VIEW_FIELDS } from '@hexly/web-entity';
import { CORE_VIEW_CONTENT } from '@hexly/plugin-content/web';

describe('WorldTypesLoader', () => {
  // A World's own Fields, resolved through the registry by the ids a type references (ADR-0054).
  const domainField = defineField({
    id: 'world.domain',
    key: 'domain',
    label: 'Domain',
    dataType: { kind: 'string' },
    facetable: true,
  });
  /** A World Owner's own **Field of a Structured Data Type**: a grid on the type they defined, no code (#201). */
  const battlemapField = defineField({
    id: 'world.battlemap',
    key: 'battlemap',
    label: 'Battlemap',
    dataType: { kind: 'core.hex-grid' },
  });

  const deity: AvailableType = { id: 'world.deity', label: 'Deity', source: 'user', fieldRefs: ['world.domain'] };
  // A plugin-source type as the API reports it. The web already knows its plugin types from code, so
  // the loader must ignore these rows rather than re-register a view-less copy over the real one.
  const monster: AvailableType = { id: 'test.monster', label: 'Monster', source: 'plugin', fieldRefs: [] };

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

  it('registers a user-defined type as a generic-Field-View definition when the World loads', () => {
    availableTypes.mockReturnValue(of([monster, deity]));
    worldId.set('w1');
    TestBed.flushEffects();

    const def = registry.get('world.deity');
    expect(def?.labelText).toBe('Deity');
    // No authored order, and no prose Field: the type affords its generic Field view alone (ADR-0051).
    // Prose is a Field of a Structured Data Type now, so a deity gets a content View only when it declares one.
    expect(def?.views).toEqual([CORE_VIEW_FIELDS]);
    // Its Fields resolve, so the generic view and facets pick them up.
    expect(registry.resolveFields(['world.deity']).map((f) => f.key)).toEqual(['domain']);
  });

  it('defaults the View of a Field of a Structured Data Type to *last*, so a deity with a battlemap still opens on its Fields', () => {
    availableTypes.mockReturnValue(of([{ ...deity, fieldRefs: ['world.domain', 'world.battlemap'] }]));
    worldId.set('w1');
    TestBed.flushEffects();

    expect(registry.get('world.deity')?.views).toEqual([CORE_VIEW_FIELDS, { field: 'battlemap' }]);
  });

  it('projects the author’s own View order verbatim, so "Show as a view" can drop one', () => {
    // The toggle, off: the `battlemap` Field is still referenced, but places no View.
    availableTypes.mockReturnValue(
      of([{ ...deity, fieldRefs: ['world.battlemap'], views: [CORE_VIEW_FIELDS, CORE_VIEW_CONTENT] }]),
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
