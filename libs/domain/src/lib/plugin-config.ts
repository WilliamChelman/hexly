import { z } from 'zod';

/**
 * The base per-Plugin config every Plugin's `configSchema` extends (ADR-0052). Its one knob today is
 * `enabled`, on by default — a bundled Plugin is live unless an operator writes `enabled: false`. A
 * Plugin adds its own knobs by `.extend()`ing this; the API composes `features.plugin.<id>` by merging
 * the bundled Plugins' schemas (mirroring how `BUNDLED_PLUGIN_TYPES` composes from the bundled set).
 *
 * Lives framework-side because `@hexly/domain` already depends on zod, so a Plugin's framework-free half
 * can export a schema built on this without dragging any new dependency in.
 */
export const basePluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
});

/** A resolved per-Plugin config: at least `enabled`, plus whatever knobs the Plugin's own schema adds. */
export type PluginConfig = z.infer<typeof basePluginConfigSchema>;

/**
 * A Plugin's config schema — the base `{ enabled }` object, optionally extended with the Plugin's own
 * knobs. Kept as `z.ZodType<PluginConfig>` so both the base and any `.extend()`ed variant assign to it,
 * and so the composing side (`config.ts`) can hold the bundled set without a per-Plugin generic.
 */
export type PluginConfigSchema = z.ZodType<PluginConfig>;
