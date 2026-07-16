import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, map, merge, of, Subject, switchMap } from 'rxjs';
import { ActiveWorld, Logger, WorldsClient } from '@hexly/web-core';
import { Field } from '@hexly/domain';
import { TypeRegistry } from './type-registry';

/**
 * Projects the active World's user-defined **Fields** into the root {@link TypeRegistry} (ADR-0054,
 * #230), the Field peer of {@link WorldTypesLoader}. On a World change it swaps in that World's Fields,
 * so one World's Fields never linger into another; the World layout injects it so it lives while a
 * World is open.
 */
@Injectable({ providedIn: 'root' })
export class WorldFieldsLoader {
  private readonly active = inject(ActiveWorld);
  private readonly worlds = inject(WorldsClient);
  private readonly registry = inject(TypeRegistry);
  private readonly logger = inject(Logger);
  private readonly destroyRef = inject(DestroyRef);

  /** Fires when the authoring surface changes the World's Fields, re-projecting without a World swap. */
  private readonly reload$ = new Subject<void>();

  constructor() {
    // Re-fetch on a World change *or* an explicit reload (a Field authored/edited/deleted in settings).
    merge(toObservable(this.active.worldId), this.reload$.pipe(map(() => this.active.worldId())))
      .pipe(
        // A failed fetch degrades to no World Fields (core/plugin Fields still resolve), logged.
        switchMap((id) =>
          id === null
            ? of<Field[]>([])
            : this.worlds.fields(id).pipe(
                catchError((err) => {
                  this.logger.error('Failed to load the World’s user-defined Fields', err);
                  return of<Field[]>([]);
                }),
              ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((fields) => this.registry.setWorldFields(fields));
  }

  /** Re-project the active World's Fields — called by the authoring surface after a mutation. */
  reload(): void {
    this.reload$.next();
  }
}
