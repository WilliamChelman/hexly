import { computed, inject, Injectable, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { EntityType, Field, isStructuredDataType } from '@hexly/domain';
import {
  CORE_VIEW_FIELDS,
  EntityTypes,
  GENERIC_TYPE_DEFINITION,
  PLUGIN_TYPES,
  TypeDefinition,
  TypeLabels,
  ViewId,
  ViewInstance,
  viewInstanceKey,
} from '@hexly/web-entity';
import { PluginRegistry } from './plugin-registry';
import { ViewRegistry } from './view-registry';

/**
 * Root registry where Entity Types make themselves known to the type-specific UI: the one place the
 * entity page, header, card, dashboard, graph, and create surfaces read per-type icon, labels, and
 * afforded view surfaces. `register()` returns an unregister fn.
 *
 * The app seeds **no** type of its own (ADR-0051): every code type arrives through {@link PLUGIN_TYPES}
 * — `core.type.note` from the content plugin, `core.type.hex-map` from the map plugin — and a World's user-defined
 * types join at runtime, projected by {@link WorldTypesLoader}.
 *
 * Implements {@link EntityTypes}, the read contract a lib injects (bound to {@link ENTITY_TYPES} in
 * `app.config.ts`), so a shared control can ask what types exist without depending on `apps/web`.
 */
@Injectable({ providedIn: 'root' })
export class TypeRegistry implements EntityTypes {
  private readonly transloco = inject(TranslocoService);
  /** Read only from {@link viewsFor}, to resolve a placed Field's data-type to the View that renders it. */
  private readonly views = inject(ViewRegistry);
  /** Owns the enablement predicate (`isTypeActive`) the reactive outputs filter through (ADR-0052, Seam 3). */
  private readonly plugins = inject(PluginRegistry);
  private readonly definitions = signal<readonly TypeDefinition[]>([]);

  /**
   * The active World's user-defined **Fields** (ADR-0054, #230), projected by {@link WorldFieldsLoader}
   * and composed over the Plugin fields by {@link resolveField}. A World Field is always active — it is
   * data, owned by no Plugin — so it never rides the enablement gate.
   */
  private readonly worldFields = signal<readonly Field[]>([]);
  private readonly worldFieldsById = computed(() => new Map(this.worldFields().map((field) => [field.id, field])));

  /** Every *enabled* definition, in registration order (the bundled plugins', then World types). */
  readonly all = computed(() => this.definitions().filter((def) => this.plugins.isTypeActive(def.id)));

  constructor() {
    // Every code type is a bundled plugin's (ADR-0051); a disabled one drops from every output here.
    for (const def of inject(PLUGIN_TYPES, { optional: true }) ?? []) this.register(def);
  }

  register(definition: TypeDefinition): () => void {
    this.definitions.update((list) => [...list, definition]);
    return () => this.definitions.update((list) => list.filter((d) => d !== definition));
  }

  /**
   * Swap the active World's user-defined Field set (ADR-0054, #230) — called by {@link WorldFieldsLoader}
   * on a World change or an authoring reload, so one World's Fields never linger into another.
   */
  setWorldFields(fields: readonly Field[]): void {
    this.worldFields.set(fields);
  }

  /**
   * Resolve one Field id → its definition, composing the active World's user-defined Fields over the
   * Plugin fields (ADR-0054, #230). A World Field wins its id (its namespace is reserved), and is always
   * active; a Plugin field rides the enablement gate, so a disabled Plugin's Field degrades to `undefined`.
   */
  private resolveField(id: string): Field | undefined {
    return this.worldFieldsById().get(id) ?? this.plugins.fieldResolver(id);
  }

  /**
   * The definition for `type`, or `undefined` for an absent, unregistered, **or disabled** id — a
   * disabled Plugin's Type reads as absent, so callers see uniform absence with no branch (ADR-0052).
   */
  get(type: string | null | undefined): TypeDefinition | undefined {
    if (type == null) return undefined;
    const def = this.definitions().find((d) => d.id === type);
    return def && this.plugins.isTypeActive(def.id) ? def : undefined;
  }

  /**
   * The definition for an Entity's primary `type`, or {@link GENERIC_TYPE_DEFINITION} for an absent,
   * unregistered, or disabled id — so chrome always resolves, never `undefined`, never a throw. The
   * `core.type.note` fallback is gone: content is a disableable Plugin now, no longer guaranteed (ADR-0052).
   */
  resolve(type: string | null | undefined): TypeDefinition {
    return this.get(type) ?? GENERIC_TYPE_DEFINITION;
  }

  /**
   * The ordered, de-duplicated {@link ViewInstance}s an Entity affords, resolved over its **effective
   * Field set** (`types`' defaults + attached `fieldIds`, ADR-0054): every type's placed views in
   * `types` order (primary first), then any attached Fields' Views. `types[0]`'s first view is the
   * default. Drives the header view toggle.
   *
   * A View is an **instance**, not a bare id: a Type's own View names no Field, while a **Structured
   * Data Type**'s View is bound to the Field it renders. A type places a Field's View by listing
   * `{ field: key }` among its views, resolved against the effective set → data-type `kind` → the View
   * the {@link ViewRegistry} holds for that kind — so two grids afford two map Views.
   *
   * A placement that cannot resolve — a Field the effective set lacks, a built-in data-type (a form
   * row, not a View), or a structured one whose plugin this build omits — contributes nothing.
   *
   * A registered type affords exactly the Views it declares. An **unregistered** type — a plugin this
   * build does not bundle — affords the generic Field view **alone** (ADR-0051): #199's content floor
   * is withdrawn, and its values (prose included) stay readable there as plain EntityDocument.
   */
  viewsFor(
    types: readonly string[] | null | undefined,
    fieldIds?: readonly string[] | null | undefined,
  ): ViewInstance[] {
    const seen = new Map<string, ViewInstance>();
    const afford = (instance: ViewInstance) => {
      const key = viewInstanceKey(instance);
      if (!seen.has(key)) seen.set(key, instance);
    };
    // A placement resolves its Field against the whole effective set (a type default or an attachment).
    const byKey = new Map(this.effectiveFields(types, fieldIds).map((field) => [field.id, field] as const));
    const affordField = (field: Field | undefined) => {
      const view = this.views.forDataType(field?.dataType.kind);
      if (field && view) afford({ viewId: view.id, fieldKey: field.id });
    };

    for (const type of types ?? []) {
      const def = this.get(type);
      if (!def) {
        afford({ viewId: CORE_VIEW_FIELDS });
        continue;
      }
      for (const placement of def.views) {
        if (typeof placement === 'string') {
          // The domain keeps a string placement opaque; `viewPlacementSchema` already pinned it to `namespace.view.name`.
          afford({ viewId: placement as ViewId });
          continue;
        }
        affordField(byKey.get(placement.field));
      }
    }
    // Attached Fields append their View after the types' (CONTEXT.md → View); dedup drops a re-placed one.
    for (const id of fieldIds ?? []) {
      const field = this.resolveField(id);
      if (!field) continue;
      // A Field of a Structured Data Type appends its own bound View; a built-in Field has no View of
      // its own, so it rides the generic Field view — its control's home (CONTEXT.md → View, ADR-0054).
      if (isStructuredDataType(field.dataType)) affordField(field);
      else afford({ viewId: CORE_VIEW_FIELDS });
    }
    return [...seen.values()];
  }

  /**
   * The union of Fields an Entity carrying `types` affords — every registered type's default Fields,
   * primary type first, deduped by id. The type-only projection of {@link effectiveFields} (no
   * attachments), for the create and type-authoring surfaces.
   */
  resolveFields(types: readonly string[] | null | undefined): Field[] {
    return this.effectiveFields(types, []);
  }

  /**
   * An Entity's **effective Field set** (CONTEXT.md → Entity, ADR-0054/ADR-0056): its attached Fields
   * (`fieldIds`) unioned with its types' defaults, deduped by `id`. Mirrors the server's
   * `WorldTypeFields.effectiveFields`.
   */
  effectiveFields(
    types: readonly string[] | null | undefined,
    fieldIds: readonly string[] | null | undefined,
  ): Field[] {
    const byId = new Map<string, Field>();
    const consider = (field: Field | undefined) => {
      if (field && !byId.has(field.id)) byId.set(field.id, field);
    };
    for (const id of fieldIds ?? []) consider(this.resolveField(id));
    for (const type of types ?? []) {
      const def = this.get(type);
      // A type declares its default Fields by id only (`fieldRefs`, ADR-0054) — one resolution path.
      for (const id of def?.fieldRefs ?? []) consider(this.resolveField(id));
    }
    return [...byId.values()];
  }

  /**
   * Resolve one registered Field by its `id` (ADR-0054) — a **World Field** or a **Plugin Field**, or
   * `undefined` for an unknown or disabled one. What the fields editor reads to label an Entity's
   * attached Field chips.
   */
  field(id: string): Field | undefined {
    return this.resolveField(id);
  }

  /**
   * Every registered Field a World Owner may reference (ADR-0054): its World-defined Fields (always
   * active) plus the enabled Plugin Fields — the offer the World Types editor's reference picker reads.
   * A disabled Plugin's Fields drop out; a reference to one would only degrade to a plain value.
   */
  availableFields(): Field[] {
    return [...this.worldFields(), ...this.plugins.fields.filter((field) => this.plugins.isFieldActive(field.id))];
  }

  /**
   * The registered Fields an Entity carrying `types`/`fieldIds` may still **attach directly** (ADR-0054):
   * every World-defined Field and enabled Plugin Field whose `id` its effective set does not already cover
   * — so the attach picker never offers a Field a type default already places, or one already attached.
   * World Fields come first (always active); a disabled Plugin's Fields drop out (they would only degrade
   * to a plain value).
   */
  attachableFields(
    types: readonly string[] | null | undefined,
    fieldIds: readonly string[] | null | undefined,
  ): Field[] {
    const present = new Set(this.effectiveFields(types, fieldIds).map((field) => field.id));
    return this.availableFields().filter((field) => !present.has(field.id));
  }

  /**
   * A type's **display name** — the noun every surface shows for it ("Note", "Hex Map", "Deity").
   * A **user-defined type's name is authored data, never a transloco key**: its `labelText` is
   * returned verbatim, while a code-registered type's name is looked up as `entityBrowser.type.<id>`.
   *
   * Read it through the `typeName` pipe in a template; call it directly from a `computed` that also
   * tracks `transloco.activeLang()`, so the name re-resolves on a language switch.
   */
  name(type: string | null | undefined): string {
    const def = this.get(type);
    return def?.labelText ?? this.transloco.translate(`entityBrowser.type.${type}`);
  }

  /**
   * One of a type's **chrome** labels — the create heading, the untitled default, the header eyebrow,
   * the editor's accessible name. A code-registered type declares these as transloco keys; a
   * user-defined type has no copy at all, so every one of its chrome labels resolves to its authored
   * name (again, never translated).
   */
  chromeLabel(type: string | null | undefined, key: keyof TypeLabels): string {
    const def = this.resolve(type);
    if (def.labelText) return def.labelText;
    return def.labels ? this.transloco.translate(def.labels[key]) : this.name(type);
  }

  /**
   * The type ids that afford `view` — e.g. `typeIdsForView('core.view.map')` backs the dashboard/list
   * "maps" filter. Asks {@link viewsFor} rather than reading the declared list, because a type affords
   * the map View by *placing a grid Field*, which is the only way any type does.
   */
  typeIdsForView(view: ViewId): EntityType[] {
    return this.all()
      .filter((d) => this.viewsFor([d.id]).some((v) => v.viewId === view))
      .map((d) => d.id);
  }
}
