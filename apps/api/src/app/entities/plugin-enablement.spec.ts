import {
  deriveFieldFacets,
  deriveSearchText,
  harvestEdges,
  resolveEffectiveFields,
  VaultExportContext,
} from '@hexly/domain';
import { entityToMarkdown } from '@hexly/obsidian';
import { CORE_NOTE, PLUGIN_ID as CONTENT_PLUGIN_ID, tiptapContent } from '@hexly/plugin-content';
import { CORE_HEX_GRID, PLUGIN_ID as HEXMAP_PLUGIN_ID } from '@hexly/plugin-hexmap';
import { DND_MONSTER, PLUGIN_ID as DND_PLUGIN_ID } from '@hexly/plugin-dnd';
import { HexlyConfig, loadConfig } from '../config';
import { BUNDLED_PLUGIN_CONFIGS } from './bundled-plugins';
import { TypeFieldRegistry } from './type-field-registry';

/**
 * "Disabled" is "never bundled" on the server (ADR-0052, Seam 2): a Plugin the enabled set omits is
 * filtered out of the bundled Type set and the bundled **Structured Data Type** set before they
 * thread into derive (edges + search text) and the **Vault Projection**. These cover a bundled set with
 * one Plugin omitted, against the same registry the real derive/vault passes resolve off.
 */
describe('plugin enablement — uniform absence on the server', () => {
  /** All bundled Plugins enabled — what an absent or empty `hexly.yml` yields (opt-out default). */
  function allEnabled(): HexlyConfig {
    return loadConfig(':memory:', BUNDLED_PLUGIN_CONFIGS);
  }

  /** The default config with the named Plugins forced off — the `features.plugin.<id>.enabled: false` knob. */
  function withDisabled(...ids: readonly string[]): HexlyConfig {
    const config = allEnabled();
    for (const id of ids) config.features.plugin[id] = { ...config.features.plugin[id], enabled: false };
    return config;
  }

  describe('the default Entity Type composition tolerates a disabled content Plugin', () => {
    it('resolves the default Entity Type when content is enabled', () => {
      expect(new TypeFieldRegistry(allEnabled()).defaultType).toBe(CORE_NOTE);
    });

    it('yields no default Entity Type — and does not throw — when content is disabled', () => {
      expect(() => new TypeFieldRegistry(withDisabled(CONTENT_PLUGIN_ID))).not.toThrow();
      expect(new TypeFieldRegistry(withDisabled(CONTENT_PLUGIN_ID)).defaultType).toBeUndefined();
    });
  });

  describe('the registry filters the bundled sets by the enabled set', () => {
    it('drops a disabled Plugin’s Structured Data Type', () => {
      expect(new TypeFieldRegistry(allEnabled()).structuredDataTypes.has(CORE_HEX_GRID)).toBe(true);
      expect(new TypeFieldRegistry(withDisabled(HEXMAP_PLUGIN_ID)).structuredDataTypes.has(CORE_HEX_GRID)).toBe(false);
    });

    it('drops a disabled Plugin’s Types — its default Field ids no longer resolve', () => {
      expect(new TypeFieldRegistry(allEnabled()).typeFieldRefs('core.hexmap')).toBeDefined();
      expect(new TypeFieldRegistry(withDisabled(HEXMAP_PLUGIN_ID)).typeFieldRefs('core.hexmap')).toBeUndefined();
    });
  });

  /** Resolve a type set's effective Field schemas off the registry, exactly as the derive/vault passes do. */
  const fieldsFor = (registry: TypeFieldRegistry, types: readonly string[]) =>
    resolveEffectiveFields({
      types,
      fieldIds: [],
      fieldResolver: registry.fieldResolver,
      typeFieldRefs: registry.typeFieldRefs,
    });

  /**
   * The instance-wide id→Field resolver (ADR-0054): the composition an Entity's directly-attached
   * `fields[]` and a Type's `fieldRefs` resolve against. A disabled Plugin's Fields drop from it, so a
   * reference to one degrades to a plain **Entity Document** value — the ADR-0052 uniform-absence rule.
   */
  describe('the registry composes the Plugin Field resolver', () => {
    it('resolves a Plugin Field id → its definition when its Plugin is enabled', () => {
      const registry = new TypeFieldRegistry(allEnabled());
      expect(registry.fieldResolver('core.grid')).toMatchObject({
        id: 'core.grid',
        key: 'grid',
        dataType: { kind: CORE_HEX_GRID },
      });
      // The content plugin owns the prose Field; the hexmap and dnd types reference it by id.
      expect(registry.fieldResolver('core.content')?.key).toBe('content');
      // The thirteen scalar stat Fields retired: dnd contributes the one `dnd.stat-block` Field now (ADR-0055).
      expect(registry.fieldResolver('dnd.stat_block')?.key).toBe('stat_block');
    });

    it('drops a disabled Plugin’s Fields — a reference degrades to a plain value', () => {
      const registry = new TypeFieldRegistry(withDisabled(HEXMAP_PLUGIN_ID));
      expect(registry.fieldResolver('core.grid')).toBeUndefined();
      // `core.content` is owned by the (still-enabled) content plugin, so the hexmap type's other
      // reference still resolves.
      expect(registry.fieldResolver('core.content')?.key).toBe('content');
    });

    it('resolves nothing for an unknown id', () => {
      expect(new TypeFieldRegistry(allEnabled()).fieldResolver('world.nope')).toBeUndefined();
    });
  });

  describe('derive over an Entity carrying a disabled Plugin’s Field of a Structured Data Type', () => {
    // A grid value with a Hex Entity Link and a Hex name — the edge and text a Hex Map contributes.
    const doc = {
      grid: {
        hexes: { '0,0': { terrain: 'grass', name: 'Ashford', entityId: 'ashford-note' } },
        regions: [],
        labels: [],
      },
    };

    it('harvests the grid’s edges and search text when hexmap is enabled', () => {
      const registry = new TypeFieldRegistry(allEnabled());
      const fields = fieldsFor(registry, ['core.hexmap']);
      expect(harvestEdges(doc, fields, registry.structuredDataTypes)).toContainEqual({
        targetKind: 'entity',
        targetId: 'ashford-note',
        descriptor: null,
      });
      expect(deriveSearchText(doc, fields, registry.structuredDataTypes)).toContain('Ashford');
    });

    it('harvests no edges and no derived search text when hexmap is disabled', () => {
      const registry = new TypeFieldRegistry(withDisabled(HEXMAP_PLUGIN_ID));
      const fields = fieldsFor(registry, ['core.hexmap']);
      expect(harvestEdges(doc, fields, registry.structuredDataTypes)).toEqual([]);
      expect(deriveSearchText(doc, fields, registry.structuredDataTypes)).toBe('');
    });
  });

  describe('facet harvest over an Entity carrying a disabled Plugin’s Field of a Structured Data Type (ADR-0055)', () => {
    // A stat block carrying the three harvested dimensions — plus an ability score that is never a facet.
    const doc = { stat_block: { size: 'Huge', creature_type: 'dragon', challenge_rating: 24, strength: 30 } };

    it('harvests the stat block’s dimensions when dnd is enabled — never its ability scores', () => {
      const registry = new TypeFieldRegistry(allEnabled());
      const fields = fieldsFor(registry, [DND_MONSTER]);
      const facets = deriveFieldFacets(fields, doc, registry.structuredDataTypes);
      expect(facets).toEqual([
        { key: 'size', value: 'Huge', num: null },
        { key: 'creature_type', value: 'dragon', num: null },
        { key: 'challenge_rating', value: '24', num: 24 },
      ]);
    });

    it('harvests no facets when dnd is disabled, leaving the stat block intact as plain document', () => {
      const registry = new TypeFieldRegistry(withDisabled(DND_PLUGIN_ID));
      const fields = fieldsFor(registry, [DND_MONSTER]);
      // The `dnd.stat-block` Data Type drops from the set, so faceting simply stops (ADR-0055)…
      expect(deriveFieldFacets(fields, doc, registry.structuredDataTypes)).toEqual([]);
      // …and the value is untouched — a lens that doesn't apply leaves the document readable.
      expect(doc.stat_block).toEqual({ size: 'Huge', creature_type: 'dragon', challenge_rating: 24, strength: 30 });
    });
  });

  describe('vault export of an Entity carrying a disabled Plugin’s Field of a Structured Data Type', () => {
    const doc = {
      content: tiptapContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The lore of Ashford' }] }],
      }),
    };
    const context: VaultExportContext = { entityName: () => undefined, assetPath: () => undefined };

    const toMarkdown = (registry: TypeFieldRegistry) =>
      entityToMarkdown({
        doc,
        fields: fieldsFor(registry, [CORE_NOTE]),
        dataTypes: registry.structuredDataTypes,
        frontmatter: {},
        context,
      });

    it('projects the content Field to the Markdown body when content is enabled', () => {
      const markdown = toMarkdown(new TypeFieldRegistry(allEnabled()));
      // Prose rides the body, not a raw `content:` frontmatter dump — so no `---` block at all.
      expect(markdown).toContain('The lore of Ashford');
      expect(markdown).not.toContain('content:');
      expect(markdown.startsWith('---')).toBe(false);
    });

    it('writes the content Field as a raw document value when content is disabled', () => {
      // `core.note` is unregistered now, so the `content` key resolves to no Field and stays opaque —
      // exactly a build that never bundled the content Plugin: the value rides the frontmatter raw
      // rather than projecting to the body.
      const markdown = toMarkdown(new TypeFieldRegistry(withDisabled(CONTENT_PLUGIN_ID)));
      expect(markdown.startsWith('---')).toBe(true);
      expect(markdown).toContain('content:');
    });
  });
});
