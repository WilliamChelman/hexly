import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { FieldSchema } from '@hexly/domain';
import { CORE_HEX_GRID } from '@hexly/plugin-hexmap';
import { DND_MONSTER } from '@hexly/plugin-dnd';
import { TypeRegistry } from './type-registry';
import {
  CORE_VIEW_CONTENT,
  CORE_VIEW_FIELDS,
  CORE_VIEW_MAP,
  TypeDefinition,
  ViewInstance,
  viewInstanceKey,
} from '@hexly/web-entity';
import { DND_VIEW_STAT_BLOCK, providePluginDnd } from '@hexly/plugin-dnd/web';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';

/** The afforded Views as their string keys — what the URL and the toggle testids carry. */
function viewKeys(instances: readonly ViewInstance[]): string[] {
  return instances.map(viewInstanceKey);
}

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
    // A code type's name/chrome resolves through Transloco, so the spec needs the testing catalog.
    // Plugin types are seeded from DI: composing the plugins is what supplies `core.hexmap` and
    // `dnd.monster`.
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
      providers: [providePluginHexmap(), providePluginDnd()],
    });
    registry = TestBed.inject(TypeRegistry);
  });

  it('seeds the core type, then the bundled plugins — all through one register()', () => {
    // `core.note` and the two plugins' types arrive by the same `register()` (ADR-0048): the app seeds
    // only the base body's type, and every other type in the build is a plugin's.
    expect(registry.all().map((d) => d.id)).toEqual(['core.note', 'core.hexmap', DND_MONSTER]);
  });

  it('composes its Structured Field data-types from the plugins provided (ADR-0050, #199)', () => {
    // The web twin of the API's `BUNDLED_STRUCTURED_DATA_TYPES`: the grid arrives with the Hex Map
    // plugin, so the app names no data-type — and a build without it resolves none.
    expect([...registry.structuredDataTypes.keys()]).toEqual([CORE_HEX_GRID]);
    expect(registry.structuredDataTypes.get(CORE_HEX_GRID)?.empty()).toEqual({
      hexes: {},
      regions: [],
      labels: [],
    });
  });

  it('resolves a registered definition by its type id', () => {
    expect(registry.get('core.hexmap')?.icon).toBe('terrain');
    expect(registry.get('core.note')?.icon).toBe('label');
  });

  it('returns undefined for an unregistered or absent type', () => {
    expect(registry.get('pathfinder.monster')).toBeUndefined();
    expect(registry.get(null)).toBeUndefined();
    expect(registry.get(undefined)).toBeUndefined();
  });

  it('resolves an unregistered or absent type to the core note fallback', () => {
    expect(registry.resolve('core.hexmap').id).toBe('core.hexmap');
    expect(registry.resolve('pathfinder.monster').id).toBe('core.note');
    expect(registry.resolve(undefined).id).toBe('core.note');
  });

  it('unions the ordered Views a type set affords — primary first, deduped', () => {
    expect(viewKeys(registry.viewsFor(['core.hexmap']))).toEqual([`${CORE_VIEW_MAP}:grid`, CORE_VIEW_CONTENT]);
    expect(viewKeys(registry.viewsFor(['core.note']))).toEqual([CORE_VIEW_CONTENT]);
    // A multi-type set unions in `types` order, deduping the shared content view.
    expect(viewKeys(registry.viewsFor(['core.hexmap', 'core.note']))).toEqual([
      `${CORE_VIEW_MAP}:grid`,
      CORE_VIEW_CONTENT,
    ]);
    expect(registry.viewsFor([])).toEqual([]);
    expect(registry.viewsFor(undefined)).toEqual([]);
  });

  it('binds a Structured Field’s View to the Field it renders, and a Type’s View to nothing', () => {
    // `core.hexmap` places its `grid` Field's View first, so the Map opens by default — and the
    // instance names the Field, which is what lets a second grid afford a second map View.
    expect(registry.viewsFor(['core.hexmap'])).toEqual([
      { viewId: CORE_VIEW_MAP, fieldKey: 'grid' },
      { viewId: CORE_VIEW_CONTENT },
    ]);
  });

  /** One View per surface the Entity's types afford — the header's whole rule (#192). */
  describe('view-per-surface for the bundled dnd.monster plugin', () => {
    it('offers the stat block and the Note view, defaulting to the plugin’s own', () => {
      expect(viewKeys(registry.viewsFor([DND_MONSTER]))).toEqual([DND_VIEW_STAT_BLOCK, CORE_VIEW_CONTENT]);
    });

    it('offers the stat block, Note, and Map when the monster also carries core.hexmap', () => {
      expect(viewKeys(registry.viewsFor([DND_MONSTER, 'core.hexmap']))).toEqual([
        DND_VIEW_STAT_BLOCK,
        CORE_VIEW_CONTENT,
        `${CORE_VIEW_MAP}:grid`,
      ]);
      // Re-primarying the hexmap re-orders the union, so the Map becomes the default View.
      expect(viewKeys(registry.viewsFor(['core.hexmap', DND_MONSTER]))).toEqual([
        `${CORE_VIEW_MAP}:grid`,
        CORE_VIEW_CONTENT,
        DND_VIEW_STAT_BLOCK,
      ]);
    });

    it('does not drag in the generic Field View — a bespoke view is what the code bought', () => {
      expect(viewKeys(registry.viewsFor([DND_MONSTER]))).not.toContain(CORE_VIEW_FIELDS);
    });
  });

  it('affords exactly the Views a registered type declares', () => {
    // A fields-only type (every user-defined one) declares the generic Field View outright…
    registry.register({ ...definition('dnd.beast', [crField]), views: [CORE_VIEW_FIELDS] });
    expect(viewKeys(registry.viewsFor(['dnd.beast']))).toEqual([CORE_VIEW_FIELDS]);
    // …and a core type declaring no Fields never surfaces it.
    expect(viewKeys(registry.viewsFor(['core.note']))).toEqual([CORE_VIEW_CONTENT]);
  });

  it('drops a placed Field it cannot resolve to a View, rather than offering a dead toggle', () => {
    // A `{ field }` placement resolves Field → data-type `kind` → the View registered for that kind.
    // Neither a Field the type never declared nor a built-in data-type (which has a form row, not a
    // View) resolves to one — so the type affords only the Views that can actually render.
    registry.register({
      ...definition('dnd.beast', [crField]),
      views: [{ field: 'cr' }, { field: 'nonesuch' }, CORE_VIEW_CONTENT],
    });
    expect(viewKeys(registry.viewsFor(['dnd.beast']))).toEqual([CORE_VIEW_CONTENT]);
  });

  describe('a user-defined type carrying a Structured Field', () => {
    const battlemap: FieldSchema = {
      key: 'battlemap',
      label: 'Battlemap',
      dataType: { kind: CORE_HEX_GRID },
      required: false,
      facetable: false,
    };

    it('affords the grid’s map View, bound to the Field — and still opens on its Fields', () => {
      registry.register({
        ...definition('world.deity', [battlemap]),
        views: [CORE_VIEW_FIELDS, CORE_VIEW_CONTENT, { field: 'battlemap' }],
      });

      // The map is last, so the default View — the primary type's first — is the deity's own Fields.
      expect(viewKeys(registry.viewsFor(['world.deity']))).toEqual([
        CORE_VIEW_FIELDS,
        CORE_VIEW_CONTENT,
        `${CORE_VIEW_MAP}:battlemap`,
      ]);
    });

    it('affords *two* map Views when it also carries core.hexmap — one per grid', () => {
      registry.register({
        ...definition('world.deity', [battlemap]),
        views: [CORE_VIEW_FIELDS, { field: 'battlemap' }],
      });

      // Two Views of one Entity, each bound to its own Field — why a View is an instance (#200).
      expect(viewKeys(registry.viewsFor(['core.hexmap', 'world.deity']))).toEqual([
        `${CORE_VIEW_MAP}:grid`,
        CORE_VIEW_CONTENT,
        CORE_VIEW_FIELDS,
        `${CORE_VIEW_MAP}:battlemap`,
      ]);
    });

    it('drops the Field’s View when "Show as a view" is off, leaving the Field itself alone', () => {
      // The toggle authors the *views* list, never the Field: the value stays, and stays declared.
      registry.register({
        ...definition('world.deity', [battlemap]),
        views: [CORE_VIEW_FIELDS, CORE_VIEW_CONTENT],
      });

      expect(viewKeys(registry.viewsFor(['world.deity']))).toEqual([CORE_VIEW_FIELDS, CORE_VIEW_CONTENT]);
      expect(registry.resolveFields(['world.deity']).map((f) => f.key)).toEqual(['battlemap']);
    });
  });

  it('falls back to Content plus the generic Field View for an unregistered type — the missing-plugin case', () => {
    // No definition registered for `pathfinder.monster`: the Entity still opens on the lore every
    // Entity has, and the generic View renders its type as an inert chip over its plain EntityDocument —
    // never a blank screen, and never a hidden value (#187, #199).
    expect(viewKeys(registry.viewsFor(['pathfinder.monster']))).toEqual([CORE_VIEW_CONTENT, CORE_VIEW_FIELDS]);
  });

  it('resolves the union of Field schemas a types[] set declares, primary type first', () => {
    registry.register(definition('dnd.beast', [crField]));
    expect(registry.resolveFields(['dnd.beast']).map((f) => f.key)).toEqual(['cr']);
    // The bundled plugin's schema resolves through the same path — the web twin of what the API's
    // write gate and facet build read (#192).
    expect(registry.resolveFields([DND_MONSTER]).map((f) => f.key)).toContain('challenge_rating');
    // `core.note` declares exactly the canonical prose Field now (ADR-0051).
    expect(registry.resolveFields(['core.note']).map((f) => f.key)).toEqual(['content']);
    // No types at all resolves to no Fields.
    expect(registry.resolveFields(undefined)).toEqual([]);
  });

  it('lists the type ids contributing a View — backing the maps filter', () => {
    expect(registry.typeIdsForView(CORE_VIEW_MAP)).toEqual(['core.hexmap']);
    expect(registry.typeIdsForView(CORE_VIEW_CONTENT)).toEqual(['core.note', 'core.hexmap', DND_MONSTER]);
  });

  it('registers a new definition and drops it via the returned unregister fn', () => {
    const def = definition('pathfinder.monster');
    const unregister = registry.register(def);

    expect(registry.get('pathfinder.monster')).toBe(def);
    unregister();
    expect(registry.get('pathfinder.monster')).toBeUndefined();
  });

  it('keeps definitions in registration order (core, plugins, then the rest)', () => {
    registry.register(definition('pathfinder.monster'));
    expect(registry.all().map((d) => d.id)).toEqual(['core.note', 'core.hexmap', DND_MONSTER, 'pathfinder.monster']);
  });

  /**
   * A user-defined type's name is authored data, so it must be shown verbatim — never looked up as a
   * transloco key, which is what leaked the raw `entityBrowser.type.world.deity` onto the Dashboard.
   */
  describe('label resolution', () => {
    /** A World-defined type: an authored `labelText`, and no transloco copy at all. */
    const userType: TypeDefinition = {
      id: 'world.deity' as TypeDefinition['id'],
      icon: 'label',
      labelText: 'Deity',
      views: [CORE_VIEW_FIELDS],
      graphColorToken: '--color-ink-muted',
    };

    it('shows a user-defined type’s authored name verbatim, never as a transloco key', () => {
      registry.register(userType);

      expect(registry.name('world.deity')).toBe('Deity');
      // Every chrome slot resolves to the authored name too — it ships no copy to translate.
      expect(registry.chromeLabel('world.deity', 'create')).toBe('Deity');
      expect(registry.chromeLabel('world.deity', 'untitled')).toBe('Deity');
      expect(registry.chromeLabel('world.deity', 'eyebrow')).toBe('Deity');
    });

    it('resolves a code type’s name and chrome through its transloco keys', () => {
      registry.register(definition('pathfinder.monster'));

      // The testing catalog has no copy for these, so transloco echoes the key — proving the *key*
      // path is taken for a code type (and, by contrast, is never taken for a user-defined one).
      expect(registry.name('pathfinder.monster')).toBe('entityBrowser.type.pathfinder.monster');
      expect(registry.chromeLabel('pathfinder.monster', 'create')).toBe('pathfinder.monster.create');
    });
  });
});

/** ADR-0048's absent-plugin degradation: a build composed one provider short of the app's. */
describe('TypeRegistry without the Hex Map plugin', () => {
  let registry: TypeRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [provideTranslocoTesting()], providers: [providePluginDnd()] });
    registry = TestBed.inject(TypeRegistry);
  });

  it('knows nothing of core.hexmap — it was the plugin’s, and the plugin is gone', () => {
    expect(registry.all().map((d) => d.id)).toEqual(['core.note', DND_MONSTER]);
    expect(registry.get('core.hexmap')).toBeUndefined();
    // Nor its grid: a Field naming `core.hex-grid` resolves against an empty set (ADR-0050).
    expect(registry.structuredDataTypes.size).toBe(0);
  });

  it('opens an existing Hex Map on its Content, with the generic Field view one toggle away', () => {
    // The Entity opens, and nothing is hidden: the lore renders as it always did, and the grid — a
    // EntityDocument value like any other — is still there, under an unrendered Field rather than a canvas.
    expect(viewKeys(registry.viewsFor(['core.hexmap']))).toEqual([CORE_VIEW_CONTENT, CORE_VIEW_FIELDS]);
    // No map View is afforded by anything, so the header offers no toggle to a canvas that isn't here.
    expect(registry.typeIdsForView(CORE_VIEW_MAP)).toEqual([]);
  });

  it('drops a *registered* type’s placed grid Field too, when the data-type’s plugin is absent', () => {
    // The type itself is here — it is World data, not the plugin's — but `core.hex-grid` resolves
    // against an empty set, so its placement contributes no View. The Field's value stays in EntityDocument,
    // unrendered, rather than offering a toggle to a canvas this build cannot draw.
    registry.register({
      id: 'world.deity' as TypeDefinition['id'],
      icon: 'label',
      labelText: 'Deity',
      views: [CORE_VIEW_FIELDS, { field: 'battlemap' }],
      fields: [
        { key: 'battlemap', label: 'Battlemap', dataType: { kind: CORE_HEX_GRID }, required: false, facetable: false },
      ],
      graphColorToken: '--color-ink-muted',
    });

    expect(viewKeys(registry.viewsFor(['world.deity']))).toEqual([CORE_VIEW_FIELDS]);
  });

  it('still renders a Hex Map’s chrome — the core note’s, the always-registered fallback', () => {
    // `resolve()` never returns undefined, so the header, card, and dashboard have an icon and labels
    // to draw for an Entity whose primary type this build cannot name.
    expect(registry.resolve('core.hexmap').id).toBe('core.note');
  });
});
