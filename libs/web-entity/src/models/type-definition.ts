import { EntityType } from '@hexly/domain';
import { IconName } from '@hexly/web-ui';
import { CORE_VIEW_FIELDS, ViewPlacement } from './view-definition';

/**
 * The transloco *keys* a type contributes to its page chrome (resolved live by
 * language, ADR-0014).
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
 * (ADR-0048) and read by the entity page, header, card, dashboard, graph, and
 * create surfaces.
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
   * The **authored** display name of a **user-defined type** — data, not a transloco key, so it is
   * never translated. Read every type's name through {@link TypeRegistry.name} (or the `typeName`
   * pipe), which returns this verbatim when present and falls back to a code type's translated copy
   * otherwise. A core/plugin type omits it.
   */
  readonly labelText?: string;
  /**
   * The Views this type contributes, in header display order (ADR-0048, *Views* amendment). The
   * header toggles the *union* an Entity's types afford, defaulting to the primary type's first View.
   *
   * An entry is either a {@link ViewId} the type contributes outright, or a reference to one of the
   * type's referenced {@link fieldRefs} Fields, whose **Structured Data Type** contributes the View
   * (ADR-0050) — named by the EntityDocument `key` that Field lenses: `core.type.hex-map` declares
   * `[{ field: 'core.field.grid' }, CORE_VIEW_RICH_CONTENT]`, its grid placed by Field, its prose View by id (ADR-0051).
   * A `{ field }` entry naming a Field the type's effective set lacks, or one whose data-type this build
   * does not register (its plugin is absent), contributes nothing.
   */
  readonly views: readonly ViewPlacement[];
  /**
   * The default Fields this type references by id (`fieldRefs`, ADR-0054) — the sole way a Type
   * declares its Fields, a typing *lens* over EntityDocument resolved through the registry (id → Field).
   * Which View renders each is the type's own choice, made in {@link views}.
   */
  readonly fieldRefs?: readonly string[];
  /**
   * The CSS custom property the World Graph paints this type's nodes with
   * (resolved to RGBA per theme, ADR-0007).
   */
  readonly graphColorToken: string;
}

/**
 * The synthetic generic default `TypeRegistry.resolve()` returns for an absent, unregistered, or disabled
 * primary type (ADR-0052) — so chrome always resolves, never `undefined`, never a throw. Framework-side,
 * not app-side, because the app authors no Type of its own (ADR-0051). Deliberately *not* fed by
 * `entities.defaultType`: an unregistered Type must read as absent, not masquerade as the default.
 */
export const GENERIC_TYPE_DEFINITION: TypeDefinition = {
  id: '' as EntityType,
  icon: 'label',
  views: [CORE_VIEW_FIELDS],
  graphColorToken: '--color-ink-muted',
  labels: {
    eyebrow: 'fields.generic.eyebrow',
    titleLabel: 'fields.generic.titleLabel',
    rename: 'fields.generic.rename',
    editorLabel: 'fields.generic.editorLabel',
    create: 'fields.generic.create',
    untitled: 'fields.generic.untitled',
  },
};
