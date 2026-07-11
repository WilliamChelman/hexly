import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, map, merge, of, Subject, switchMap } from 'rxjs';
import { ActiveWorld, Logger, WorldsClient } from '@hexly/web-core';
import { AvailableType } from '@hexly/domain';
import { TypeDefinition } from './type-definition';
import { TypeRegistry } from './type-registry';
import { CORE_VIEW_FIELDS } from './view-definition';

/**
 * Loads the **active World's user-defined types** into the {@link TypeRegistry} (ADR-0048, #191).
 *
 * A user-defined type is authored data scoped to one World, but every type-aware surface — the
 * create dialog, the Type facet, the generic Field View, the entity header — reads the one root
 * {@link TypeRegistry}. So rather than teach each surface a second, World-scoped source, this loader
 * *projects* the active World's types into that registry: when the active World changes it fetches
 * `GET /worlds/:id/types`, registers each user-defined type as a {@link TypeDefinition}, and
 * unregisters the previous World's set. That keeps World scoping honest — one World's `world.deity`
 * never lingers into another — while every consumer stays oblivious to where a type came from.
 *
 * It is a plain reactive singleton with no template; the World layout injects it so it lives for as
 * long as a World is open.
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
        switchMap((id) =>
          id === null
            ? of<AvailableType[]>([])
            : // A failed fetch degrades to no user-defined types (the core/plugin types still work),
              // logged rather than swallowed. It re-runs on the next World change or reload.
              this.worlds.availableTypes(id).pipe(
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
 * Project a user-defined {@link AvailableType} onto a {@link TypeDefinition}: a generic icon, the
 * generic Field View as its only View (so an Entity carrying it always renders its Fields, even
 * when it declares none — the type then shows as an inert chip), its authored `label` as the literal
 * `labelText`, and its Field schema. The transloco-key `labels` all fall back to the literal name.
 */
function toDefinition(type: AvailableType): TypeDefinition {
  return {
    id: type.id,
    icon: 'label',
    labelText: type.label,
    // A user-defined type has no bespoke code view; the generic Field View is its renderer.
    views: [CORE_VIEW_FIELDS],
    fields: type.fields,
    graphColorToken: '--color-ink-muted',
    // The name is authored data, not a transloco key — the loose keys degrade to it via the
    // missing-key fallback, so the header eyebrow / create command read the type's name.
    labels: {
      eyebrow: type.label,
      titleLabel: type.label,
      rename: type.label,
      editorLabel: type.label,
      create: type.label,
      untitled: type.label,
    },
  };
}
