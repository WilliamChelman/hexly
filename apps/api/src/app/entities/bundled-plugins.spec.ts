import {
  CONTENT_FIELD_ID,
  CORE_NOTE,
  CORE_NOTE_TYPE,
  CORE_RICH_CONTENT,
  PLUGIN_ID as CONTENT_PLUGIN_ID,
} from '@hexly/plugin-content';
import {
  CORE_HEX_GRID,
  CORE_HEXMAP_TYPE,
  HEX_GRID_FIELD_ID,
  PLUGIN_ID as HEXMAP_PLUGIN_ID,
} from '@hexly/plugin-hexmap';
import { DND_MONSTER, DND_MONSTER_TYPE, DND_STAT_BLOCK, PLUGIN_ID as DND_PLUGIN_ID } from '@hexly/plugin-dnd';
import { serverPluginContent } from '@hexly/plugin-content/server';
import { serverPluginHexmap } from '@hexly/plugin-hexmap/server';
import { serverPluginDnd } from '@hexly/plugin-dnd/server';
import { loadConfig } from '../config';
import {
  BUNDLED_PLUGIN_CONFIGS,
  BUNDLED_PLUGIN_TYPE_OWNERS,
  BUNDLED_STRUCTURED_DATA_TYPE_OWNERS,
  enabledPluginFields,
} from './bundled-plugins';

/** Plugin identity at the API composition root (ADR-0052, #215) — the owner associations, not filtering. */
describe('bundled plugin identity', () => {
  it("each bundled plugin carries its framework-free half's canonical id", () => {
    expect(CONTENT_PLUGIN_ID).toBe('content');
    expect(HEXMAP_PLUGIN_ID).toBe('hexmap');
    expect(DND_PLUGIN_ID).toBe('dnd');
    expect(serverPluginContent().id).toBe(CONTENT_PLUGIN_ID);
    expect(serverPluginHexmap().id).toBe(HEXMAP_PLUGIN_ID);
    expect(serverPluginDnd().id).toBe(DND_PLUGIN_ID);
  });

  it('associates each contributed Entity Type with the Plugin that owns it', () => {
    // The namespace cannot answer this — `core.note` and `core.hexmap` share `core` but belong to
    // different Plugins — so the owner is read off each plugin's id.
    expect(BUNDLED_PLUGIN_TYPE_OWNERS.get(CORE_NOTE)).toBe(CONTENT_PLUGIN_ID);
    expect(BUNDLED_PLUGIN_TYPE_OWNERS.get('core.hexmap')).toBe(HEXMAP_PLUGIN_ID);
    expect(BUNDLED_PLUGIN_TYPE_OWNERS.get(DND_MONSTER)).toBe(DND_PLUGIN_ID);
  });

  it('associates each Structured Data Type with the Plugin that owns it', () => {
    expect(BUNDLED_STRUCTURED_DATA_TYPE_OWNERS.get(CORE_RICH_CONTENT)).toBe(CONTENT_PLUGIN_ID);
    expect(BUNDLED_STRUCTURED_DATA_TYPE_OWNERS.get(CORE_HEX_GRID)).toBe(HEXMAP_PLUGIN_ID);
    // dnd now owns the `dnd.stat-block` Data Type — the first plugin-contributed harvest source (ADR-0055).
    expect(BUNDLED_STRUCTURED_DATA_TYPE_OWNERS.get(DND_STAT_BLOCK)).toBe(DND_PLUGIN_ID);
  });
});

/**
 * The bundled **Plugin Fields** compose into the instance-wide id→Field set (ADR-0054, #226): the set
 * an Entity's directly-attached `fields[]` and a Type's `fieldRefs` resolve against, folded from the
 * plugins' `defineField` declarations exactly as the type and data-type sets are.
 */
describe('bundled Plugin Fields', () => {
  const fields = () => enabledPluginFields(loadConfig(':memory:', BUNDLED_PLUGIN_CONFIGS));

  it('folds each enabled Plugin’s registered Fields into one id-keyed set', () => {
    const ids = fields().map((field) => field.id);
    // content owns the prose Field; hexmap owns the grid Field; dnd owns the stat block.
    expect(ids).toContain(CONTENT_FIELD_ID);
    expect(ids).toContain(HEX_GRID_FIELD_ID);
    expect(ids).toContain('dnd.stat_block');
  });

  it('declares each Field id exactly once — a plugin references another’s Field by id, never re-declares it', () => {
    // The hexmap and dnd types both reference `core.content`, but only the content plugin declares it.
    const ids = fields().map((field) => field.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === CONTENT_FIELD_ID)).toHaveLength(1);
  });

  it('resolves every `fieldRef` a bundled Type references to a bundled Field', () => {
    const byId = new Set(fields().map((field) => field.id));
    for (const type of [CORE_NOTE_TYPE, CORE_HEXMAP_TYPE, DND_MONSTER_TYPE])
      for (const ref of type.fieldRefs) expect(byId.has(ref)).toBe(true);
  });
});

/** The bundled config contributions compose `features.plugin` (ADR-0052, #216). */
describe('bundled plugin config', () => {
  it('contributes one config schema per bundled Plugin, keyed by canonical id', () => {
    expect(BUNDLED_PLUGIN_CONFIGS.map((p) => p.id).sort()).toEqual(
      [CONTENT_PLUGIN_ID, DND_PLUGIN_ID, HEXMAP_PLUGIN_ID].sort(),
    );
  });

  it('resolves every bundled Plugin enabled on a :memory: Instance — content included, none privileged', () => {
    const plugin = loadConfig(':memory:', BUNDLED_PLUGIN_CONFIGS).features.plugin;
    expect(plugin[CONTENT_PLUGIN_ID].enabled).toBe(true);
    expect(plugin[HEXMAP_PLUGIN_ID].enabled).toBe(true);
    expect(plugin[DND_PLUGIN_ID].enabled).toBe(true);
  });
});
