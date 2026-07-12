import { inject, Injectable, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { CORE_NOTE, EntityType, FieldSchema, resolveFields, structuredDataTypeSet } from '@hexly/domain';
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
 * Root registry where Entity Types make themselves known to the type-specific UI
 * — modelled on {@link CommandRegistry} (ADR-0032): a `providedIn: 'root'`
 * singleton whose `register()` returns an unregister fn. It is the one place the
 * entity page, header, card, dashboard, graph, and create surfaces read
 * per-type icon, labels, and afforded view surfaces, replacing the scattered
 * `type === 'hexmap'` / `type === 'note'` branches (ADR-0048).
 *
 * `core.note` registers through the same path a bundled plugin does — the two seedings below are one
 * call with different data (ADR-0048) — and it is the only type the app itself seeds: the Hex Map's
 * chrome arrives from `providePluginHexmap()` like any other plugin's (ADR-0050, #199). A World's
 * user-defined types join the same registry at runtime, projected by {@link WorldTypesLoader} (#191).
 *
 * It implements {@link EntityTypes}, the read contract a lib injects (the app binds it to
 * {@link ENTITY_TYPES} in `app.config.ts`), so a shared control can ask what types exist without
 * depending on `apps/web`.
 */
@Injectable({ providedIn: 'root' })
export class TypeRegistry implements EntityTypes {
  private readonly transloco = inject(TranslocoService);
  /**
   * Read-only, and only from {@link viewsFor}: a Type *places* one of its Fields among its Views, and
   * which View renders that Field's data-type is the {@link ViewRegistry}'s to say (ADR-0050). The
   * dependency runs one way — the View registry never asks about types.
   */
  private readonly views = inject(ViewRegistry);
  private readonly definitions = signal<readonly TypeDefinition[]>([]);

  /** Every registered definition, in registration order (core, then the bundled plugins). */
  readonly all = this.definitions.asReadonly();

  constructor() {
    for (const def of CORE_TYPE_DEFINITIONS) this.register(def);
    // The bundled plugins' types (`core.hexmap`, `dnd.monster`): instance-wide, through the call the
    // core just used. They arrive from whichever `providePluginX()` the app provided, so the registry
    // never learns a plugin's name — and a spec gets a plugin's types by providing that plugin,
    // nothing else. Drop one, and its Entities degrade to the generic Field view (see `viewsFor`).
    for (const def of inject(PLUGIN_TYPES, { optional: true }) ?? []) this.register(def);
  }

  /**
   * The **Structured Field** data-types this build carries (ADR-0050) — the web twin of the API's
   * `BUNDLED_STRUCTURED_DATA_TYPES`, threaded into the domain to validate a Field and mint its
   * default. Composed from the plugins the app provided (#199), so the grid arrives with the Hex Map
   * rather than being named here: the web registers a data-type exactly as the API does, in one place.
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
   * The definition for `type`, falling back to the core `core.note` for an absent
   * or unregistered id — for the chrome (icon, labels) that must always resolve to
   * *something*, mirroring the old `?? TYPE_LABELS['note']` default. Non-optional:
   * `core.note` is always registered. Callers pass an Entity's *primary* type
   * (`types[0]`) here, which drives its icon, headline, and default view.
   */
  resolve(type: string | null | undefined): TypeDefinition {
    // `core.note` is seeded in the constructor, so the fallback is always present.
    return this.get(type) ?? this.get(CORE_NOTE)!;
  }

  /**
   * The ordered, de-duplicated {@link ViewInstance}s an Entity carrying `types` affords — the union of
   * every type's placed views, in `types` order, primary type first (ADR-0048, *Views* amendment).
   * Drives the header view toggle: a note yields `[core.view.content]` (one view, no toggle); a hexmap
   * yields `[core.view.map:grid, core.view.content]`; a `[dnd.monster, core.hexmap]` composes all
   * three (stat block, Note, and Map). `types[0]`'s first view is the default.
   *
   * A View is an **instance**, not a bare id (ADR-0050, #200): a Type's own View (a plugin's stat
   * block, Content, the generic Field view) names no Field, while a **Structured Field**'s View is
   * bound to the Field it renders. A type places a Field's View by listing `{ field: key }` among its
   * views; the placement resolves Field → data-type `kind` → the View the {@link ViewRegistry} holds
   * for that kind. Two grids on one Entity therefore afford two map Views, distinct by Field key.
   *
   * A placement that cannot resolve — a Field the type never declared, a built-in data-type (which
   * has a form row, not a View), or a structured one whose plugin this build omits — contributes
   * nothing, rather than a toggle to a view that cannot render.
   *
   * A registered type affords exactly the Views it declares: a plugin shipping a bespoke view does not
   * also get the generic Field View, while a fields-only type (every user-defined one, #191) declares
   * `core.view.fields` outright.
   *
   * An **unregistered** type — a plugin this build does not bundle — affords the Content view and
   * the generic Field view instead (#199). Both, and in that order: the Entity opens on the lore it
   * has always had, and one toggle away its type shows as an inert chip over its values as plain
   * Metadata (#187) — a Hex Map on an Instance without the map plugin, exactly as ADR-0048 promised.
   * Nothing is hidden by a missing plugin; the Metadata, grid and all, is still there to read.
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
   * The union of Field schemas an Entity carrying `types` affords (ADR-0048, #187) — every
   * registered type's declared Fields, primary type first, deduped by Metadata key. Delegates to
   * the pure domain {@link resolveFields}; the generic Field View reads it to render and edit a
   * typed Entity's Fields as a lens over its one Metadata map.
   */
  resolveFields(types: readonly string[] | null | undefined): FieldSchema[] {
    return resolveFields((type) => this.get(type)?.fields, types ?? []);
  }

  /**
   * A type's **display name** — the noun every surface shows for it ("Note", "Hex Map", "Deity").
   * The single home of the rule that a **user-defined type's name is authored data, never a
   * transloco key** (#191): its `labelText` is returned verbatim, and only a code-registered type's
   * name is looked up as `entityBrowser.type.<id>` copy. An unregistered id falls back to the raw
   * key lookup, as it did before.
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
   * "maps" filter (the types that afford the map view). Asks {@link viewsFor} rather than reading the
   * declared list, so a type affords the map View by *placing a grid Field* — which is the only way
   * any type does now, `core.hexmap` included (#200).
   */
  typeIdsForView(view: ViewId): EntityType[] {
    return this.definitions()
      .filter((d) => this.viewsFor([d.id]).some((v) => v.viewId === view))
      .map((d) => d.id);
  }
}
