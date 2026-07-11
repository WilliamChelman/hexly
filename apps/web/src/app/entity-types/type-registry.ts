import { inject, Injectable, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { CORE_NOTE, EntityType, FieldSchema, resolveFields } from '@hexly/domain';
import { TypeDefinition, TypeLabels } from './type-definition';
import { CORE_TYPE_DEFINITIONS } from './core-types';
import { CORE_VIEW_FIELDS, ViewId } from './view-definition';

/**
 * Root registry where Entity Types make themselves known to the type-specific UI
 * — modelled on {@link CommandRegistry} (ADR-0032): a `providedIn: 'root'`
 * singleton whose `register()` returns an unregister fn. It is the one place the
 * entity page, header, card, dashboard, graph, and create surfaces read
 * per-type icon, labels, and afforded view surfaces, replacing the scattered
 * `type === 'hexmap'` / `type === 'note'` branches (ADR-0048).
 *
 * Core `note`/`hexmap` register through the same path a bundled plugin would, so
 * the type API is exercised by the core. They are seeded here for this prefactor;
 * #184 moves core registration into its own internal lib.
 */
@Injectable({ providedIn: 'root' })
export class TypeRegistry {
  private readonly transloco = inject(TranslocoService);
  private readonly definitions = signal<readonly TypeDefinition[]>([]);

  /** Every registered definition, in registration order (core first). */
  readonly all = this.definitions.asReadonly();

  constructor() {
    for (const def of CORE_TYPE_DEFINITIONS) this.register(def);
  }

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
   * The ordered, de-duplicated {@link ViewId}s an Entity carrying `types` affords —
   * the union of every type's contributed views, in `types` order, primary type
   * first (ADR-0048, *Views* amendment). Drives the header view toggle: a note
   * yields `[core.view.content]` (one view, no toggle); a hexmap yields
   * `[core.view.map, core.view.content]`; a future `[dnd.monster, core.hexmap]`
   * composes all three. `types[0]`'s first view is the default.
   */
  viewsFor(types: readonly string[] | null | undefined): ViewId[] {
    const seen = new Set<ViewId>();
    for (const type of types ?? []) {
      const def = this.get(type);
      if (def) {
        for (const view of def.views) seen.add(view);
        // A type that declares Fields additionally affords the generic Field View (ADR-0048, #187).
        if (def.fields?.length) seen.add(CORE_VIEW_FIELDS);
      } else {
        // An absent/unregistered type — a missing plugin, a World-defined type with no code — falls
        // back to the generic Field View, which shows it as an inert chip over its plain Metadata.
        seen.add(CORE_VIEW_FIELDS);
      }
    }
    return [...seen];
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
   * The type ids that contribute `view` — e.g. `typeIdsForView('core.view.map')`
   * backs the dashboard/list "maps" filter (the types that afford the map view).
   */
  typeIdsForView(view: ViewId): EntityType[] {
    return this.definitions()
      .filter((d) => d.views.includes(view))
      .map((d) => d.id);
  }
}
