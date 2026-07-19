import { BOARD_SURFACE_DATA_TYPE, CORE_BOARD_TYPE, SURFACE_FIELD } from '@hexly/plugin-board';
import { boardConfigSchema, serverPluginBoard } from './index';

describe('serverPluginBoard (ADR-0053, #263)', () => {
  it('registers the Board type, the surface Field, and the surface data-type', () => {
    const plugin = serverPluginBoard();
    expect(plugin.id).toBe('board');
    expect(plugin.types).toEqual([CORE_BOARD_TYPE]);
    expect(plugin.fields).toEqual([SURFACE_FIELD]);
    expect(plugin.dataTypes).toEqual([BOARD_SURFACE_DATA_TYPE]);
  });

  describe('config schema — features.plugin.board (ADR-0052, ADR-0062)', () => {
    it('extends the base { enabled } with maxEmbedDepth, defaulting to 3', () => {
      const config = boardConfigSchema.parse({});
      expect(config).toEqual({ enabled: true, maxEmbedDepth: 3 });
    });

    it('accepts an operator-tuned positive integer', () => {
      expect(boardConfigSchema.parse({ maxEmbedDepth: 5 })).toMatchObject({ maxEmbedDepth: 5 });
    });

    it('rejects a non-positive or non-integer depth', () => {
      expect(boardConfigSchema.safeParse({ maxEmbedDepth: 0 }).success).toBe(false);
      expect(boardConfigSchema.safeParse({ maxEmbedDepth: 2.5 }).success).toBe(false);
    });
  });
});
