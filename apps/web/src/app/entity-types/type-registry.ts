import { Injectable, signal } from '@angular/core';
import { CORE_NOTE, EntityType } from '@hexly/domain';
import { TypeDefinition } from './type-definition';
import { CORE_TYPE_DEFINITIONS } from './core-types';
import { ViewId } from './view-definition';

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
  private readonly definitions = signal<readonly TypeDefinition[]>([]);

  /** Every registered definition, in registration order (core first). */
  readonly all = this.definitions.asReadonly();

  constructor() {
    for (const def of CORE_TYPE_DEFINITIONS) this.register(def);
  }

  register(definition: TypeDefinition): () => void {
    this.definitions.update((list) => [...list, definition]);
    return () =>
      this.definitions.update((list) => list.filter((d) => d !== definition));
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
    for (const type of types ?? [])
      for (const view of this.get(type)?.views ?? []) seen.add(view);
    return [...seen];
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
