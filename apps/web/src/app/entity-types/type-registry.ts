import { Injectable, signal } from '@angular/core';
import { EntityType } from '@hexly/domain';
import { TypeDefinition } from './type-definition';
import { CORE_TYPE_DEFINITIONS } from './core-types';

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
   * The definition for `type`, falling back to the core `note` for an absent or
   * unregistered id — for the chrome (icon, labels) that must always resolve to
   * *something*, mirroring the old `?? TYPE_LABELS['note']` default. Non-optional:
   * `note` is always registered.
   */
  resolve(type: string | null | undefined): TypeDefinition {
    // `note` is seeded in the constructor, so the fallback is always present.
    return this.get(type) ?? this.get('note')!;
  }

  /**
   * Whether `type`'s payload affords the hex-grid map surface — drives the
   * Map/Note toggle, the grid layout + status bar, and the split-on-save.
   */
  affordsMap(type: string | null | undefined): boolean {
    return this.get(type)?.surfaces.includes('map') ?? false;
  }

  /** The type ids that afford a map surface — the dashboard/list "maps" filter. */
  mapTypeIds(): EntityType[] {
    return this.definitions()
      .filter((d) => d.surfaces.includes('map'))
      .map((d) => d.id);
  }
}
