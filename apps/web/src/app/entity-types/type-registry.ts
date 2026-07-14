import { inject, Injectable, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { EntityType, FieldSchema, resolveFields, structuredDataTypeSet } from '@hexly/domain';
import { CORE_NOTE } from '@hexly/plugin-content';
import {
  CORE_VIEW_CONTENT,
  CORE_VIEW_FIELDS,
  EntityTypes,
  PLUGIN_DATA_TYPES,
  PLUGIN_TYPES,
  TypeDefinition,
  TypeLabels,
  ViewId,
  ViewInstance,
  viewInstanceKey,
} from '@hexly/web-entity';
import { CORE_TYPE_DEFINITIONS } from './core-types';
import { ViewRegistry } from './view-registry';

/**
 * Root registry where Entity Types make themselves known to the type-specific UI: the one place the
 * entity page, header, card, dashboard, graph, and create surfaces read per-type icon, labels, and
 * afforded view surfaces. `register()` returns an unregister fn.
 *
 * `core.note` is the only type the app itself seeds; plugin types arrive through {@link PLUGIN_TYPES},
 * and a World's user-defined types join at runtime, projected by {@link WorldTypesLoader}.
 *
 * Implements {@link EntityTypes}, the read contract a lib injects (bound to {@link ENTITY_TYPES} in
 * `app.config.ts`), so a shared control can ask what types exist without depending on `apps/web`.
 */
@Injectable({ providedIn: 'root' })
export class TypeRegistry implements EntityTypes {
  private readonly transloco = inject(TranslocoService);
  /** Read only from {@link viewsFor}, to resolve a placed Field's data-type to the View that renders it. */
  private readonly views = inject(ViewRegistry);
  private readonly definitions = signal<readonly TypeDefinition[]>([]);

  /** Every registered definition, in registration order (core, then the bundled plugins). */
  readonly all = this.definitions.asReadonly();

  constructor() {
    for (const def of CORE_TYPE_DEFINITIONS) this.register(def);
    // Bundled plugin types (`core.hexmap`, `dnd.monster`). Drop a plugin, and its Entities degrade to
    // the generic Field view (see `viewsFor`).
    for (const def of inject(PLUGIN_TYPES, { optional: true }) ?? []) this.register(def);
  }

  /**
   * The **Structured Field** data-types this build carries, composed from the provided plugins, and
   * threaded into the domain to validate a Field and mint its default.
   */
  readonly structuredDataTypes = structuredDataTypeSet(inject(PLUGIN_DATA_TYPES, { optional: true }) ?? []);

  register(definition: TypeDefinition): () => void {
    this.definitions.update((list) => [...list, definition]);
    return () => this.definitions.update((list) => list.filter((d) => d !== definition));
  }

  /** The definition registered for `type`, or `undefined` for an absent/unregistered id. */
  get(type: string | null | undefined): TypeDefinition | undefined {
    if (type == null) return undefined;
    return this.definitions().find((d) => d.id === type);
  }

  /**
   * The definition for `type`, falling back to `core.note` for an absent or unregistered id, so chrome
   * (icon, labels) always resolves to *something*. Callers pass an Entity's *primary* type (`types[0]`),
   * which drives its icon, headline, and default view.
   */
  resolve(type: string | null | undefined): TypeDefinition {
    // `core.note` is seeded in the constructor, so the fallback is always present.
    return this.get(type) ?? this.get(CORE_NOTE)!;
  }

  /**
   * The ordered, de-duplicated {@link ViewInstance}s an Entity carrying `types` affords — the union of
   * every type's placed views, in `types` order, primary type first. `types[0]`'s first view is the
   * default. Drives the header view toggle.
   *
   * A View is an **instance**, not a bare id: a Type's own View names no Field, while a **Structured
   * Field**'s View is bound to the Field it renders. A type places a Field's View by listing
   * `{ field: key }` among its views, resolving Field → data-type `kind` → the View the
   * {@link ViewRegistry} holds for that kind — so two grids afford two map Views.
   *
   * A placement that cannot resolve — a Field the type never declared, a built-in data-type (which has
   * a form row, not a View), or a structured one whose plugin this build omits — contributes nothing,
   * rather than a toggle to a view that cannot render.
   *
   * A registered type affords exactly the Views it declares; a fields-only type declares
   * `core.view.fields` outright. An **unregistered** type — a plugin this build does not bundle —
   * affords the Content view and the generic Field view instead, in that order, so its values remain
   * readable as plain EntityDocument.
   */
  viewsFor(types: readonly string[] | null | undefined): ViewInstance[] {
    const seen = new Map<string, ViewInstance>();
    const afford = (instance: ViewInstance) => {
      const key = viewInstanceKey(instance);
      if (!seen.has(key)) seen.set(key, instance);
    };

    for (const type of types ?? []) {
      const def = this.get(type);
      if (!def) {
        afford({ viewId: CORE_VIEW_CONTENT });
        afford({ viewId: CORE_VIEW_FIELDS });
        continue;
      }
      for (const placement of def.views) {
        if (typeof placement === 'string') {
          afford({ viewId: placement });
          continue;
        }
        const field = def.fields?.find((f) => f.key === placement.field);
        const view = this.views.forDataType(field?.dataType.kind);
        if (field && view) afford({ viewId: view.id, fieldKey: field.key });
      }
    }
    return [...seen.values()];
  }

  /**
   * The union of Field schemas an Entity carrying `types` affords — every registered type's declared
   * Fields, primary type first, deduped by EntityDocument key.
   */
  resolveFields(types: readonly string[] | null | undefined): FieldSchema[] {
    return resolveFields((type) => this.get(type)?.fields, types ?? []);
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
    return this.definitions()
      .filter((d) => this.viewsFor([d.id]).some((v) => v.viewId === view))
      .map((d) => d.id);
  }
}
