import { Injectable, signal } from '@angular/core';
import { EntityType } from '@hexly/domain';

/**
 * Bridges the `>`-prefix create Commands (ADR-0032) to the always-mounted
 * {@link CreateEntityDialog}: a Command's `run()` has no reference to that component,
 * so it opens the dialog through this shared signal instead.
 */
@Injectable({ providedIn: 'root' })
export class CreateEntityDialogState {
  // The ordered type set the dialog opens seeded with; `types[0]` primary (ADR-0048, #189). A
  // Command opens it with a single type and the dialog lets the author add more before creating.
  private readonly _types = signal<readonly EntityType[] | null>(null);

  readonly types = this._types.asReadonly();

  open(type: EntityType): void {
    this._types.set([type]);
  }

  close(): void {
    this._types.set(null);
  }
}
