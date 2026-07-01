import { Injectable, signal } from '@angular/core';
import { EntityType } from '@hexly/domain';

/**
 * The seam between the Create Note / Create Map Commands and the create dialog
 * (ADR-0032). A Command is uniform — it only knows how to `run()` — so instead of
 * rendering UI itself it asks this root service to open the dialog for a type; the
 * {@link CreateEntityDialog} mounted by the Palette reacts to {@link type}.
 */
@Injectable({ providedIn: 'root' })
export class CreateEntityLauncher {
  private readonly _type = signal<EntityType | null>(null);

  /** The type to create, or `null` when the dialog is closed. */
  readonly type = this._type.asReadonly();

  open(type: EntityType): void {
    this._type.set(type);
  }

  close(): void {
    this._type.set(null);
  }
}
