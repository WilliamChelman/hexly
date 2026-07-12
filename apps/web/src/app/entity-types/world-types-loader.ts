import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, map, merge, of, Subject, switchMap } from 'rxjs';
import { ActiveWorld, Logger, WorldsClient } from '@hexly/web-core';
import { AvailableType } from '@hexly/domain';
import { TypeDefinition, userTypeViews } from '@hexly/web-entity';
import { TypeRegistry } from './type-registry';

/**
 * Projects the active World's user-defined types into the root {@link TypeRegistry} (ADR-0048, #191),
 * so every type-aware surface (create dialog, Type facet, generic Field View) resolves them without a
 * second World-scoped source. On a World change it fetches the World's types, registers each, and
 * unregisters the previous set — so one World's types never linger into another. The World layout
 * injects it so it lives while a World is open.
 */
@Injectable({ providedIn: 'root' })
export class WorldTypesLoader {
  private readonly active = inject(ActiveWorld);
  private readonly worlds = inject(WorldsClient);
  private readonly registry = inject(TypeRegistry);
  private readonly logger = inject(Logger);
  private readonly destroyRef = inject(DestroyRef);

  /** The unregister fns for the currently-projected World's types, cleared on every World change. */
  private unregister: (() => void)[] = [];

  /** Fires when the authoring surface changes the World's types, re-projecting without a World swap. */
  private readonly reload$ = new Subject<void>();

  constructor() {
    // Re-fetch on a World change *or* an explicit reload (a type authored/edited/deleted in settings).
    merge(toObservable(this.active.worldId), this.reload$.pipe(map(() => this.active.worldId())))
      .pipe(
        // A failed fetch degrades to no user-defined types (core/plugin types still work), logged.
        switchMap((id) =>
          id === null
            ? of<AvailableType[]>([])
            : this.worlds.availableTypes(id).pipe(
                catchError((err) => {
                  this.logger.error('Failed to load the World’s user-defined types', err);
                  return of<AvailableType[]>([]);
                }),
              ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((types) => this.project(types));
  }

  /** Re-project the active World's types — called by the authoring surface after a mutation. */
  reload(): void {
    this.reload$.next();
  }

  /** Swap the registered set: drop the previous World's types, register this World's user-defined ones. */
  private project(types: readonly AvailableType[]): void {
    for (const off of this.unregister) off();
    this.unregister = types
      .filter((type) => type.source === 'user')
      .map((type) => this.registry.register(toDefinition(type)));
  }
}

/**
 * Project a user-defined {@link AvailableType} onto a {@link TypeDefinition}: its authored **View**
 * order, its Field schema, and its authored name as `labelText`. It declares **no** transloco
 * `labels` — a user-defined type ships no copy, so every label it shows is that authored name,
 * resolved through {@link TypeRegistry.name}/`chromeLabel`.
 *
 * The `views` list is the *same* {@link ViewPlacement} list a plugin type declares in code, so the
 * registry resolves both down one path (#201) — a user-defined type is not a second kind of citizen
 * with a hardcoded view.
 */
function toDefinition(type: AvailableType): TypeDefinition {
  return {
    id: type.id,
    icon: 'label',
    labelText: type.label,
    // Absent is not empty: a type whose author never named an order (every one predating the "Show as
    // a view" toggle) falls back to Fields, Content, and each of its Structured Fields.
    views: type.views ?? userTypeViews(type.fields),
    fields: type.fields,
    graphColorToken: '--color-ink-muted',
  };
}
