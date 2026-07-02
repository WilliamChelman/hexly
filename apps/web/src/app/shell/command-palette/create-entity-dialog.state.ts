import { Injectable, signal } from '@angular/core';
import { EntityType } from '@hexly/domain';

/**
 * Bridges the `>`-prefix Create Note / Create Map Commands (ADR-0032) to the
 * always-mounted {@link CreateEntityDialog}: a Command's `run()` has no
 * reference to that component, so it opens the dialog through this shared
 * signal instead — the same "global service, one always-mounted renderer"
 * shape as {@link ToasterService}/{@link Toaster}.
 */
@Injectable({ providedIn: 'root' })
export class CreateEntityDialogState {
  private readonly _type = signal<EntityType | null>(null);

  readonly type = this._type.asReadonly();

  open(type: EntityType): void {
    this._type.set(type);
  }

  close(): void {
    this._type.set(null);
  }
}
