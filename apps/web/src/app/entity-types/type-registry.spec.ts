import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { TestBed } from '@angular/core/testing';
import { FieldSchema } from '@hexly/domain';
import { DND_MONSTER } from '@hexly/plugin-dnd';
import { TypeRegistry } from './type-registry';
import { CORE_VIEW_CONTENT, CORE_VIEW_FIELDS, CORE_VIEW_MAP, TypeDefinition } from '@hexly/web-entity';
import { DND_VIEW_STAT_BLOCK, providePluginDnd } from '@hexly/plugin-dnd/web';

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
    // The registry resolves a code type's name/chrome through Transloco (a user-defined type's
    // authored name never goes near it), so the spec needs the testing catalog. The plugin types are
    // seeded from DI, so a spec gets `dnd.monster` by composing the plugin as `app.config.ts` does (#192).
    TestBed.configureTestingModule({ imports: [provideTranslocoTesting()], providers: [providePluginDnd()] });
    registry = TestBed.inject(TypeRegistry);
  });

  it('seeds the core types, then the bundled plugins — all through one register()', () => {
    // `core.note`/`core.hexmap` and `dnd.monster` arrive by the same `register()` (ADR-0048, #192).
    expect(registry.all().map((d) => d.id)).toEqual(['core.note', 'core.hexmap', DND_MONSTER]);
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
    expect(registry.viewsFor(['core.hexmap'])).toEqual([CORE_VIEW_MAP, CORE_VIEW_CONTENT]);
    expect(registry.viewsFor(['core.note'])).toEqual([CORE_VIEW_CONTENT]);
    // A multi-type set unions in `types` order, deduping the shared content view.
    expect(registry.viewsFor(['core.hexmap', 'core.note'])).toEqual([CORE_VIEW_MAP, CORE_VIEW_CONTENT]);
    expect(registry.viewsFor([])).toEqual([]);
    expect(registry.viewsFor(undefined)).toEqual([]);
  });

  /** One View per surface the Entity's types afford — the header's whole rule (#192). */
  describe('view-per-surface for the bundled dnd.monster plugin', () => {
    it('offers the stat block and the Note view, defaulting to the plugin’s own', () => {
      expect(registry.viewsFor([DND_MONSTER])).toEqual([DND_VIEW_STAT_BLOCK, CORE_VIEW_CONTENT]);
    });

    it('offers the stat block, Note, and Map when the monster also carries core.hexmap', () => {
      expect(registry.viewsFor([DND_MONSTER, 'core.hexmap'])).toEqual([
        DND_VIEW_STAT_BLOCK,
        CORE_VIEW_CONTENT,
        CORE_VIEW_MAP,
      ]);
      // Re-primarying the hexmap re-orders the union, so the Map becomes the default View.
      expect(registry.viewsFor(['core.hexmap', DND_MONSTER])).toEqual([
        CORE_VIEW_MAP,
        CORE_VIEW_CONTENT,
        DND_VIEW_STAT_BLOCK,
      ]);
    });

    it('does not drag in the generic Field View — a bespoke view is what the code bought', () => {
      expect(registry.viewsFor([DND_MONSTER])).not.toContain(CORE_VIEW_FIELDS);
    });
  });

  it('affords exactly the Views a registered type declares', () => {
    // A fields-only type (every user-defined one) declares the generic Field View outright…
    registry.register({ ...definition('dnd.beast', [crField]), views: [CORE_VIEW_FIELDS] });
    expect(registry.viewsFor(['dnd.beast'])).toEqual([CORE_VIEW_FIELDS]);
    // …and a core type declaring no Fields never surfaces it.
    expect(registry.viewsFor(['core.note'])).toEqual([CORE_VIEW_CONTENT]);
  });

  it('falls back to the generic Field View for an unregistered type — the missing-plugin case', () => {
    // No definition registered for `pathfinder.monster`: the Entity still affords the generic View,
    // which renders it as an inert chip over its plain Metadata rather than a blank screen.
    expect(registry.viewsFor(['pathfinder.monster'])).toEqual([CORE_VIEW_FIELDS]);
  });

  it('resolves the union of Field schemas a types[] set declares, primary type first', () => {
    registry.register(definition('dnd.beast', [crField]));
    expect(registry.resolveFields(['dnd.beast']).map((f) => f.key)).toEqual(['cr']);
    // The bundled plugin's schema resolves through the same path — the web twin of what the API's
    // write gate and facet build read (#192).
    expect(registry.resolveFields([DND_MONSTER]).map((f) => f.key)).toContain('challenge_rating');
    // A set of types that declare no Fields resolves to none — values stay plain Metadata.
    expect(registry.resolveFields(['core.note'])).toEqual([]);
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
