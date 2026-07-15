import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { FieldSchema } from '@hexly/domain';
import { ENABLED_PLUGINS } from '@hexly/web-core';
import { CORE_HEX_GRID, PLUGIN_ID as HEXMAP_PLUGIN_ID } from '@hexly/plugin-hexmap';
import { CORE_RICH_CONTENT, PLUGIN_ID as CONTENT_PLUGIN_ID } from '@hexly/plugin-content';
import { DND_MONSTER, PLUGIN_ID as DND_PLUGIN_ID } from '@hexly/plugin-dnd';
import { TypeRegistry } from './type-registry';
import {
  CORE_VIEW_FIELDS,
  CORE_VIEW_MAP,
  PLUGIN_IDS,
  TypeDefinition,
  ViewInstance,
  viewInstanceKey,
} from '@hexly/web-entity';
import { CORE_VIEW_CONTENT, providePluginContent } from '@hexly/plugin-content/web';
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
      providers: [providePluginContent(), providePluginHexmap(), providePluginDnd()],
    });
    registry = TestBed.inject(TypeRegistry);
  });

  it('seeds every code type from a bundled plugin — all through one register()', () => {
    // The app seeds no type of its own now (ADR-0051): `core.note` arrives from the content plugin,
    // `core.hexmap` from the map plugin, `dnd.monster` from the dnd plugin — all by the same
    // `register()`, in provider order.
    expect(registry.all().map((d) => d.id)).toEqual(['core.note', 'core.hexmap', DND_MONSTER]);
  });

  it('composes its Structured Field data-types from the plugins provided (ADR-0050, ADR-0051)', () => {
    // The web twin of the API's `BUNDLED_STRUCTURED_DATA_TYPES`: prose arrives with the content plugin,
    // the grid with the Hex Map plugin, so the app names no data-type — and a build without one resolves
    // none of its kind.
    expect([...registry.structuredDataTypes.keys()]).toEqual([CORE_RICH_CONTENT, CORE_HEX_GRID]);
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

  it('resolves an unregistered or absent type to synthetic generic chrome — never the note, never a throw', () => {
    // The `?? core.note` crutch is gone (ADR-0052): content is disableable now, so no Type is
    // guaranteed present. A registered type resolves to itself; anything else to the generic default —
    // its own View list the generic Field View, and its labels generic keys, not `core.note`'s.
    expect(registry.resolve('core.hexmap').id).toBe('core.hexmap');
    expect(registry.resolve('pathfinder.monster').id).not.toBe('core.note');
    expect(registry.resolve('pathfinder.monster').views).toEqual([CORE_VIEW_FIELDS]);
    expect(registry.resolve(undefined).views).toEqual([CORE_VIEW_FIELDS]);
    // The generic keys resolve through the app catalog, so chrome reads as a sensible noun, not broken.
    expect(registry.chromeLabel('pathfinder.monster', 'create')).toBe('New entity');
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

  it('each composed plugin records its canonical id under PLUGIN_IDS (ADR-0052, #215)', () => {
    expect(TestBed.inject(PLUGIN_IDS)).toEqual([CONTENT_PLUGIN_ID, HEXMAP_PLUGIN_ID, DND_PLUGIN_ID]);
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

  describe('a user-defined type carrying two prose Fields (#210)', () => {
    const prose = (key: string, label: string): FieldSchema => ({
      key,
      label,
      dataType: { kind: CORE_RICH_CONTENT },
      required: false,
      facetable: false,
    });

    it('affords a content View per prose Field, each bound to its own key — two prose Fields coexist', () => {
      // Prose is a Structured Field like the grid, so two `core.rich-content` Fields afford two content
      // Views, each bound to the Field it renders — the twin of two grids affording two map Views (#202).
      registry.register({
        ...definition('world.saint', [prose('content', 'Content'), prose('secrets', 'Secrets')]),
        views: [CORE_VIEW_FIELDS, { field: 'content' }, { field: 'secrets' }],
      });

      expect(viewKeys(registry.viewsFor(['world.saint']))).toEqual([
        CORE_VIEW_FIELDS,
        `${CORE_VIEW_CONTENT}:content`,
        `${CORE_VIEW_CONTENT}:secrets`,
      ]);
      // Both Fields are declared and resolve — neither shadows the other.
      expect(registry.resolveFields(['world.saint']).map((f) => f.key)).toEqual(['content', 'secrets']);
    });
  });

  it('affords the generic Field View *alone* for an unregistered type — the missing-plugin case', () => {
    // No definition registered for `pathfinder.monster`: #199's content floor is withdrawn (ADR-0051),
    // so the Entity opens on the generic View alone — its type an inert chip, its values (prose
    // included) shown there as plain EntityDocument. No data-type is privileged: no content View is
    // afforded for a Field the absent plugin never declared.
    expect(viewKeys(registry.viewsFor(['pathfinder.monster']))).toEqual([CORE_VIEW_FIELDS]);
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
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
      providers: [providePluginContent(), providePluginDnd()],
    });
    registry = TestBed.inject(TypeRegistry);
  });

  it('knows nothing of core.hexmap — it was the plugin’s, and the plugin is gone', () => {
    expect(registry.all().map((d) => d.id)).toEqual(['core.note', DND_MONSTER]);
    expect(registry.get('core.hexmap')).toBeUndefined();
    // Nor its grid: a Field naming `core.hex-grid` resolves against a set holding only prose (ADR-0050).
    expect(registry.structuredDataTypes.has(CORE_HEX_GRID)).toBe(false);
    expect(registry.structuredDataTypes.has(CORE_RICH_CONTENT)).toBe(true);
  });

  it('opens an existing Hex Map on the generic Field view alone — the withdrawn content floor', () => {
    // The Entity opens, and nothing is hidden: `core.hexmap` is unregistered, so it affords the generic
    // View alone (ADR-0051), and the grid — a EntityDocument value like any other — is still there,
    // under an unrendered Field rather than a canvas. Its prose is shown there too, unrendered.
    expect(viewKeys(registry.viewsFor(['core.hexmap']))).toEqual([CORE_VIEW_FIELDS]);
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

  it('still renders a Hex Map’s chrome — the synthetic generic default, no longer the note’s', () => {
    // `resolve()` never returns undefined, so the header, card, and dashboard have an icon and labels
    // to draw for an Entity whose primary type this build cannot name. The fallback is generic chrome
    // now, not `core.note` (ADR-0052): content is a disableable Plugin, no longer a guaranteed anchor.
    const chrome = registry.resolve('core.hexmap');
    expect(chrome.id).not.toBe('core.note');
    expect(chrome.icon).toBe('label');
    expect(chrome.views).toEqual([CORE_VIEW_FIELDS]);
  });
});

/**
 * ADR-0052, Seam 3: every bundled plugin is composed, but the enabled-set signal disables some — the
 * runtime "disabled = never bundled" that a real Instance's `hexly.yml` drives. "Disabled" must read
 * identically to "never compiled in" (the describe above), and it must recompute reactively.
 */
describe('TypeRegistry filtering by the enabled-Plugin set', () => {
  let registry: TypeRegistry;
  let enabled: WritableSignal<ReadonlySet<string>>;

  beforeEach(() => {
    // Content + hexmap enabled, dnd disabled — the whole build composed, the signal turning dnd off.
    enabled = signal<ReadonlySet<string>>(new Set([CONTENT_PLUGIN_ID, HEXMAP_PLUGIN_ID]));
    TestBed.configureTestingModule({
      imports: [provideTranslocoTesting()],
      providers: [
        providePluginContent(),
        providePluginHexmap(),
        providePluginDnd(),
        { provide: ENABLED_PLUGINS, useValue: enabled },
      ],
    });
    registry = TestBed.inject(TypeRegistry);
  });

  it('omits a disabled Plugin’s Types from `all`, `get`, and the View-toggle inputs', () => {
    // `all` drops dnd.monster; the enabled Types stay in registration order.
    expect(registry.all().map((d) => d.id)).toEqual(['core.note', 'core.hexmap']);
    // A disabled Type reads as absent — never registered — so every caller degrades with no branch.
    expect(registry.get(DND_MONSTER)).toBeUndefined();
    // Its Entity affords the generic Field View alone (its values readable there), not the stat block.
    expect(viewKeys(registry.viewsFor([DND_MONSTER]))).toEqual([CORE_VIEW_FIELDS]);
    // The maps filter and the content-view type list omit it too.
    expect(registry.typeIdsForView(CORE_VIEW_CONTENT)).toEqual(['core.note', 'core.hexmap']);
  });

  it('resolves a disabled Type to synthetic generic chrome — never a throw, never the note', () => {
    const chrome = registry.resolve(DND_MONSTER);
    expect(chrome.id).not.toBe('core.note');
    expect(chrome.views).toEqual([CORE_VIEW_FIELDS]);
    expect(registry.chromeLabel(DND_MONSTER, 'eyebrow')).toBe('Entity');
  });

  it('recomputes reactively when the enabled set changes after construction', () => {
    // dnd off at boot…
    expect(registry.all().map((d) => d.id)).not.toContain(DND_MONSTER);
    // …a late-arriving set (initializer timing, or a future live push) turns it on with no re-register.
    enabled.set(new Set([CONTENT_PLUGIN_ID, HEXMAP_PLUGIN_ID, DND_PLUGIN_ID]));
    expect(registry.all().map((d) => d.id)).toContain(DND_MONSTER);
    expect(viewKeys(registry.viewsFor([DND_MONSTER]))).toEqual([DND_VIEW_STAT_BLOCK, CORE_VIEW_CONTENT]);
    // …and turning content off drops core.note, the once-privileged Type, like any other.
    enabled.set(new Set([HEXMAP_PLUGIN_ID, DND_PLUGIN_ID]));
    expect(registry.get('core.note')).toBeUndefined();
  });

  it('leaves a World’s user-defined Type untouched — it has no owning Plugin to disable', () => {
    // A user-defined Type is data, not a Plugin's; it is never in the owner map, so the enabled set
    // never gates it — even when it places a disabled Plugin's data-type (that Field just degrades).
    registry.register({
      id: 'world.deity' as TypeDefinition['id'],
      icon: 'label',
      labelText: 'Deity',
      views: [CORE_VIEW_FIELDS],
      graphColorToken: '--color-ink-muted',
    });
    enabled.set(new Set()); // every Plugin off — the coherent generic-everywhere state
    expect(registry.get('world.deity')?.labelText).toBe('Deity');
    expect(registry.all().map((d) => d.id)).toEqual(['world.deity']);
  });

  it('degrades a disabled Plugin’s placed Field to no View — even on an enabled Type', () => {
    // With hexmap disabled, an *enabled* user-defined Type placing `core.hex-grid` resolves its grid
    // View against the disabled Plugin's data-type: no View, so the Field is a plain value (ADR-0052).
    enabled.set(new Set([CONTENT_PLUGIN_ID])); // hexmap off, its View gone from the ViewRegistry
    registry.register({
      id: 'world.realm' as TypeDefinition['id'],
      icon: 'label',
      labelText: 'Realm',
      views: [CORE_VIEW_FIELDS, { field: 'battlemap' }],
      fields: [
        { key: 'battlemap', label: 'Battlemap', dataType: { kind: CORE_HEX_GRID }, required: false, facetable: false },
      ],
      graphColorToken: '--color-ink-muted',
    });
    expect(viewKeys(registry.viewsFor(['world.realm']))).toEqual([CORE_VIEW_FIELDS]);
  });
});
