import { EntityType } from '@hexly/domain';
import { IconName } from '@hexly/web-ui';

/**
 * A view surface an Entity's payload affords — mirrors `EntityView` from
 * `@hexly/web-map`. Every type affords the Content body (`'note'`); a type whose
 * payload adds the hex grid also affords `'map'`, so the header offers the
 * Note/Map toggle. Kept as a local vocabulary so the registry doesn't depend on
 * the map lib for a two-member string set (ADR-0048).
 */
export type ViewSurface = 'map' | 'note';

/**
 * The transloco *keys* a type contributes to its page chrome (resolved live by
 * language, ADR-0014). Consolidates what the scattered branches used to hard-code
 * in `TYPE_LABELS` and inline ternaries.
 */
export interface TypeLabels {
  /** The header eyebrow tag. */
  readonly eyebrow: string;
  /** The title textbox's aria-label. */
  readonly titleLabel: string;
  /** The in-place rename affordance tooltip. */
  readonly rename: string;
  /** The Content editor's aria-label. */
  readonly editorLabel: string;
  /** The create-command / create-dialog heading. */
  readonly create: string;
  /** The default name a blank create falls back to. */
  readonly untitled: string;
}

/**
 * One Entity Type's UI behaviour, registered with the {@link TypeRegistry}
 * (ADR-0048). It gathers everything the `type === 'hexmap'` / `type === 'note'`
 * branches and the ad-hoc `TYPE_LABELS` / `typeIcon` maps used to spread across
 * the entity page, header, card, dashboard, graph, and create surfaces.
 *
 * This prefactor keeps the single-valued `type` and registers only the two core
 * types; the later `types[]` flip and plugin / user-defined types build on this
 * seam.
 */
export interface TypeDefinition {
  readonly id: EntityType;
  /** The card and dashboard-tile icon. */
  readonly icon: IconName;
  readonly labels: TypeLabels;
  /**
   * The surfaces this type's payload affords, in header display order. A plain
   * note affords only its Content body; a hexmap adds the grid, so it also
   * affords `'map'` and gets the Note/Map toggle, the status bar, and split-on-save.
   */
  readonly surfaces: readonly ViewSurface[];
  /**
   * The CSS custom property the World Graph paints this type's nodes with
   * (resolved to RGBA per theme, ADR-0007). The one type-specific graph knob.
   */
  readonly graphColorToken: string;
}
