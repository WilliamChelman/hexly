import { TestBed } from '@angular/core/testing';
import { Signal, signal, WritableSignal } from '@angular/core';
import { ClientConfigStore } from '@hexly/web-core';
import { CORE_HEX_GRID, PLUGIN_ID as HEXMAP_PLUGIN_ID } from '@hexly/plugin-hexmap';
import { CORE_RICH_CONTENT, PLUGIN_ID as CONTENT_PLUGIN_ID } from '@hexly/plugin-content';
import { DND_MONSTER, DND_STAT_BLOCK, PLUGIN_ID as DND_PLUGIN_ID } from '@hexly/plugin-dnd';
import { CORE_VIEW_CONTENT, providePluginContent } from '@hexly/plugin-content/web';
import { DND_VIEW_STAT_BLOCK, providePluginDnd } from '@hexly/plugin-dnd/web';
import { providePluginHexmap } from '@hexly/plugin-hexmap/web';
import { CORE_VIEW_FIELDS, CORE_VIEW_MAP } from '@hexly/web-entity';
import { PluginRegistry } from './plugin-registry';

/** A loaded {@link ClientConfigStore} reporting exactly `enabled` — mutate the signal to drive reactivity. */
function fakeClientConfig(enabled: Signal<ReadonlySet<string>>): ClientConfigStore {
  return {
    enabledPlugins: enabled,
    defaultType: signal(undefined),
    isPluginEnabled: (id: string) => enabled().has(id),
    init: async () => undefined,
  } as unknown as ClientConfigStore;
}

describe('PluginRegistry', () => {
  describe('structured data-types composed from the plugins provided (ADR-0050, ADR-0051)', () => {
    it('resolves prose from content and the grid from hexmap — the web twin of BUNDLED_STRUCTURED_DATA_TYPES', () => {
      TestBed.configureTestingModule({
        providers: [providePluginContent(), providePluginHexmap(), providePluginDnd()],
      });
      const plugins = TestBed.inject(PluginRegistry);

      expect([...plugins.structuredDataTypes.keys()]).toEqual([CORE_RICH_CONTENT, CORE_HEX_GRID, DND_STAT_BLOCK]);
      expect(plugins.structuredDataTypes.get(CORE_HEX_GRID)?.empty()).toEqual({ hexes: {}, regions: [], labels: [] });
    });

    it('resolves none of a plugin’s kind when that plugin is not composed', () => {
      TestBed.configureTestingModule({ providers: [providePluginContent(), providePluginDnd()] });
      const plugins = TestBed.inject(PluginRegistry);

      expect(plugins.structuredDataTypes.has(CORE_RICH_CONTENT)).toBe(true);
      expect(plugins.structuredDataTypes.has(CORE_HEX_GRID)).toBe(false);
    });
  });

  describe('Plugin-Field resolver composed from the plugins provided (ADR-0054)', () => {
    it('resolves a Field by id — the prose Field from content, the stat-block Field from dnd', () => {
      TestBed.configureTestingModule({
        providers: [providePluginContent(), providePluginHexmap(), providePluginDnd()],
      });
      const plugins = TestBed.inject(PluginRegistry);

      expect(plugins.fieldResolver('core.content')?.key).toBe('content');
      expect(plugins.fieldResolver('core.grid')?.key).toBe('grid');
      // The thirteen scalar stat Fields retired: dnd contributes the one `dnd.stat-block` Field now (ADR-0055).
      expect(plugins.fieldResolver('dnd.stat_block')?.key).toBe('stat_block');
    });

    it('resolves nothing for an absent plugin’s Field — dropped from the effective set, value left intact', () => {
      TestBed.configureTestingModule({ providers: [providePluginContent(), providePluginDnd()] });
      const plugins = TestBed.inject(PluginRegistry);

      expect(plugins.fieldResolver('core.content')).toBeDefined();
      expect(plugins.fieldResolver('core.grid')).toBeUndefined(); // hexmap not composed
    });
  });

  describe('enablement predicates', () => {
    let plugins: PluginRegistry;
    let enabled: WritableSignal<ReadonlySet<string>>;

    beforeEach(() => {
      // Whole build composed; the loaded config turns dnd off.
      enabled = signal<ReadonlySet<string>>(new Set([CONTENT_PLUGIN_ID, HEXMAP_PLUGIN_ID]));
      TestBed.configureTestingModule({
        providers: [
          providePluginContent(),
          providePluginHexmap(),
          providePluginDnd(),
          { provide: ClientConfigStore, useValue: fakeClientConfig(enabled) },
        ],
      });
      plugins = TestBed.inject(PluginRegistry);
    });

    it('gates a Type/View by its owning Plugin, and never gates an ownerless contribution', () => {
      expect(plugins.isTypeActive('core.note')).toBe(true);
      expect(plugins.isTypeActive(DND_MONSTER)).toBe(false);
      // A World's user-defined Type has no owning Plugin, so it is never gated.
      expect(plugins.isTypeActive('world.deity')).toBe(true);

      expect(plugins.isViewActive(CORE_VIEW_CONTENT)).toBe(true);
      expect(plugins.isViewActive(DND_VIEW_STAT_BLOCK)).toBe(false);
      // The app-owned generic Field View has no owner either.
      expect(plugins.isViewActive(CORE_VIEW_FIELDS)).toBe(true);
    });

    it('recomputes when the enabled set changes', () => {
      expect(plugins.isTypeActive(DND_MONSTER)).toBe(false);
      enabled.set(new Set([CONTENT_PLUGIN_ID, HEXMAP_PLUGIN_ID, DND_PLUGIN_ID]));
      expect(plugins.isTypeActive(DND_MONSTER)).toBe(true);
      expect(plugins.isViewActive(DND_VIEW_STAT_BLOCK)).toBe(true);
    });

    it('degrades an attached Field of a disabled Plugin: the resolver drops it, leaving its value plain (ADR-0054)', () => {
      // A `dnd.stat_block` an Entity attached directly bypasses the Type layer, so the Field resolver
      // must gate it by its owning Plugin — else a disabled dnd would still type the value.
      expect(plugins.isFieldActive('dnd.stat_block')).toBe(false);
      expect(plugins.fieldResolver('dnd.stat_block')).toBeUndefined();
      // A still-enabled Plugin's Field resolves as ever; an ownerless (World-defined) id is never gated.
      expect(plugins.fieldResolver('core.content')?.key).toBe('content');
      expect(plugins.isFieldActive('world.element')).toBe(true);

      enabled.set(new Set([CONTENT_PLUGIN_ID, HEXMAP_PLUGIN_ID, DND_PLUGIN_ID]));
      expect(plugins.fieldResolver('dnd.stat_block')?.key).toBe('stat_block');
    });

    it('fieldDefinition resolves a disabled Plugin’s Field regardless of enablement — so a detach can still clear its key (#229)', () => {
      // The enablement-gated resolver drops it, but detach needs the key to clear the value even
      // when the owning Plugin is off — only a build that never bundled the Field leaves an orphan.
      expect(plugins.fieldResolver('dnd.stat_block')).toBeUndefined();
      expect(plugins.fieldDefinition('dnd.stat_block')?.key).toBe('stat_block');
      expect(plugins.fieldDefinition('pathfinder.nonesuch')).toBeUndefined();
    });
  });

  describe('with no loaded config (not-yet-booted / failed-fetch)', () => {
    it('reads everything enabled — the real store falls open until init() resolves (ADR-0052)', () => {
      // No ClientConfigStore override, so the real store is used; it is never init()'d here.
      TestBed.configureTestingModule({ providers: [providePluginContent(), providePluginDnd()] });
      const plugins = TestBed.inject(PluginRegistry);
      expect(plugins.isTypeActive(DND_MONSTER)).toBe(true);
      expect(plugins.isViewActive(CORE_VIEW_CONTENT)).toBe(true);
    });
  });
});
