import { CORE_NOTE, CORE_RICH_CONTENT, PLUGIN_ID as CONTENT_PLUGIN_ID } from '@hexly/plugin-content';
import { CORE_HEX_GRID, PLUGIN_ID as HEXMAP_PLUGIN_ID } from '@hexly/plugin-hexmap';
import { DND_MONSTER, PLUGIN_ID as DND_PLUGIN_ID } from '@hexly/plugin-dnd';
import { serverPluginContent } from '@hexly/plugin-content/server';
import { serverPluginHexmap } from '@hexly/plugin-hexmap/server';
import { serverPluginDnd } from '@hexly/plugin-dnd/server';
import { loadConfig } from '../config';
import {
  BUNDLED_PLUGIN_CONFIGS,
  BUNDLED_PLUGIN_TYPE_OWNERS,
  BUNDLED_STRUCTURED_DATA_TYPE_OWNERS,
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

  it('associates each Structured Field data-type with the Plugin that owns it', () => {
    expect(BUNDLED_STRUCTURED_DATA_TYPE_OWNERS.get(CORE_RICH_CONTENT)).toBe(CONTENT_PLUGIN_ID);
    expect(BUNDLED_STRUCTURED_DATA_TYPE_OWNERS.get(CORE_HEX_GRID)).toBe(HEXMAP_PLUGIN_ID);
    // dnd contributes a Type but no data-type, so it owns none.
    expect([...BUNDLED_STRUCTURED_DATA_TYPE_OWNERS.values()]).not.toContain(DND_PLUGIN_ID);
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
