import { Injectable, signal } from '@angular/core';
import { EntityDetail, EntityDocument, EntityType } from '@hexly/domain';
import { ENTITY_SESSION, EntitySession, LiveEditor, Patch } from './entity-session';

/**
 * A minimal in-memory {@link EntitySession} for a **pre-existence** surface (#438): the create-Entity
 * dialog builds a type set and a seed EntityDocument before the Entity — and thus a live session —
 * exists, yet still wants the one reusable {@link EntityTypeManagerComponent}. It carries only the type
 * set and the document; there is no server, no autosave, no {@link current} detail. `mutate` is a plain
 * shallow write (a pre-existence host only sets top-level keys), so this pulls in no Immer runtime.
 *
 * Provide it under {@link ENTITY_SESSION} at the host and inject the concrete class to read/seed its
 * {@link types}/{@link doc} directly — {@link provideLocalEntitySession}.
 */
@Injectable()
export class LocalEntitySession implements EntitySession {
  private readonly _doc = signal<EntityDocument>({});
  readonly doc = this._doc.asReadonly();

  private readonly _types = signal<readonly EntityType[]>([]);
  readonly types = this._types.asReadonly();

  private readonly _fields = signal<readonly string[]>([]);
  readonly fields = this._fields.asReadonly();

  /** No Entity is open on a pre-existence surface — the type set is the whole substance here. */
  readonly current = signal<EntityDetail | null>(null).asReadonly();
  /** A create surface is always writable to its author; the server gate lands on submit, not here. */
  readonly writable = signal(true).asReadonly();
  readonly loadGeneration = signal(0).asReadonly();

  setTypes(types: readonly EntityType[]): void {
    this._types.set([...types]);
  }

  mutate(recipe: (draft: EntityDocument) => void): { redo: Patch[]; undo: Patch[] } {
    const draft = { ...this._doc() };
    recipe(draft);
    this._doc.set(draft);
    // No View here keeps its own undo/redo stack, so no patches are produced.
    return { redo: [], undo: [] };
  }

  applyPatches(): void {
    // No undo/redo channel on a pre-existence surface.
  }

  attachField(id: string): void {
    if (id in this._doc()) return;
    this._doc.set({ ...this._doc(), [id]: null });
    this._fields.update((fields) => (fields.includes(id) ? fields : [...fields, id]));
  }

  detachField(id: string): void {
    if (id in this._doc()) {
      const next = { ...this._doc() };
      delete next[id];
      this._doc.set(next);
    }
    this._fields.update((fields) => fields.filter((f) => f !== id));
  }

  registerEditor(_editor: LiveEditor): () => void {
    return () => undefined;
  }
}

/**
 * Bind a {@link LocalEntitySession} to {@link ENTITY_SESSION} and expose the concrete class, so a host
 * both hands it to the shared control and reads/seeds its state directly (one instance, both keys).
 */
export function provideLocalEntitySession() {
  return [LocalEntitySession, { provide: ENTITY_SESSION, useExisting: LocalEntitySession }];
}
