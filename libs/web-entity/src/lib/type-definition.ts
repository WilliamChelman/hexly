import { EntityType, FieldSchema } from '@hexly/domain';
import { IconName } from '@hexly/web-ui';
import { ViewId } from './view-definition';

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
  /**
   * The transloco keys for this type's page chrome — declared by a **code-registered** type (core or
   * plugin), which is the only kind that ships translated copy. Absent on a user-defined type, whose
   * every label is its authored {@link labelText}.
   */
  readonly labels?: TypeLabels;
  /**
   * The **authored** display name of a **user-defined type** (#191) — data, not a transloco key, so
   * it is never translated. Read every type's name through {@link TypeRegistry.name} (or the
   * `typeName` pipe), which returns this verbatim when present and falls back to a code type's
   * translated copy otherwise. A core/plugin type omits it.
   */
  readonly labelText?: string;
  /**
   * The {@link ViewId}s this type contributes, in header display order (ADR-0048,
   * *Views* amendment). A plain note contributes only `core.view.content`; a hexmap
   * also contributes `core.view.map`, so it gets the view toggle and the status bar.
   * The header toggles the *union* an Entity's types afford, defaulting to the
   * primary type's first View.
   */
  readonly views: readonly ViewId[];
  /**
   * The type's **Field schema** (ADR-0048, #187): the Metadata keys it types, each
   * with a data-type and required-ness. A typing *lens* over Metadata — values stay
   * in the one Metadata map. Which View renders them is the type's own choice, made
   * in {@link views}: a user-defined type (and any plugin shipping no code) lists
   * `core.view.fields`; a plugin that ships a bespoke view (`dnd.monster`) lists that
   * instead. The core types declare no Fields at all, so this is optional.
   */
  readonly fields?: readonly FieldSchema[];
  /**
   * The CSS custom property the World Graph paints this type's nodes with
   * (resolved to RGBA per theme, ADR-0007). The one type-specific graph knob.
   */
  readonly graphColorToken: string;
}
