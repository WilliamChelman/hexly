import { Provider, signal } from '@angular/core';
import { EntityDetail, EntityDocument, EntityType } from '@hexly/domain';
import { applyPatches as immerApplyPatches, Draft, Patch, produceWithPatches } from '@hexly/immer';
import { ENTITY_SESSION, EntitySession, LiveEditor } from '../models/entity-session';

/**
 * A minimal in-memory {@link EntitySession} for a View lib's specs: it carries only the **Entity
 * Document** (ADR-0051) — so a spec seeds whatever slice its View reads. {@link loadDoc} bumps
 * {@link loadGeneration}, the reset seam a live View watches.
 */
export class FakeEntitySession implements EntitySession {
  private readonly _current = signal<EntityDetail | null>(null);
  readonly current = this._current.asReadonly();

  private readonly _doc = signal<EntityDocument>({});
  readonly doc = this._doc.asReadonly();

  private readonly _writable = signal(true);
  readonly writable = this._writable.asReadonly();

  private readonly _types = signal<readonly EntityType[]>([]);
  readonly types = this._types.asReadonly();

  private readonly _fields = signal<readonly string[]>([]);
  readonly fields = this._fields.asReadonly();

  private readonly _loadGeneration = signal(0);
  readonly loadGeneration = this._loadGeneration.asReadonly();

  /** Live editors registered for flush-before-save (ADR-0051); exposed so a spec can drive them. */
  readonly editors = new Set<LiveEditor>();

  /** Seed the opening document without a load tick — for a subclass to open on its slice. No ctor param, so DI can build it. */
  protected seedDoc(doc: EntityDocument): void {
    this._doc.set(doc);
  }

  mutate(recipe: (draft: EntityDocument) => void): {
    redo: Patch[];
    undo: Patch[];
  } {
    const [next, redo, undo] = produceWithPatches(this._doc(), recipe as (draft: Draft<EntityDocument>) => void);
    this._doc.set(next as EntityDocument);
    return { redo, undo };
  }

  applyPatches(patches: Patch[]): void {
    this._doc.set(immerApplyPatches(this._doc(), patches));
  }

  registerEditor(editor: LiveEditor): () => void {
    this.editors.add(editor);
    return () => this.editors.delete(editor);
  }

  setTypes(types: readonly EntityType[]): void {
    this._types.set([...types]);
  }

  /** Attach a Field: a `null` document key plus the id in the attached set. A no-op if already present. */
  attachField(id: string): void {
    if (id in this._doc()) return;
    this._doc.set({ ...this._doc(), [id]: null });
    this._fields.update((fields) => (fields.includes(id) ? fields : [...fields, id]));
  }

  /** Detach a Field: drop its document key and its place in the attached set. */
  detachField(id: string): void {
    if (id in this._doc()) {
      const next = { ...this._doc() };
      delete next[id];
      this._doc.set(next);
    }
    this._fields.update((fields) => fields.filter((f) => f !== id));
  }

  /** Test helper: seed the attached Field ids ({@link fields}) directly. */
  setFields(fields: readonly string[]): void {
    this._fields.set([...fields]);
  }

  /** Test helper: adopt `doc` as a fresh load and bump the load generation (a new Entity). */
  loadDoc(doc: EntityDocument): void {
    this._doc.set(doc);
    this._loadGeneration.update((n) => n + 1);
  }

  /**
   * Test helper: adopt a full {@link EntityDetail} as a fresh load — sets {@link current} and seeds
   * {@link doc} from `detail.document`, bumping the load generation. For a View whose chrome reads
   * Entity-level facts (types, id) off {@link current}, not just the document slice.
   */
  loadDetail(detail: EntityDetail): void {
    this._current.set(detail);
    this._types.set(detail.types);
    // Attached extras derive from the document in the real session; a fresh load starts with none, and a
    // spec seeds them explicitly via {@link setFields}/{@link attachField} after loading.
    this._fields.set([]);
    this.loadDoc(detail.document);
  }

  /** Test helper: flip edit-ability (ADR-0037), the gate {@link EntitySession.writable} exposes. */
  setWritable(writable: boolean): void {
    this._writable.set(writable);
  }
}

/**
 * Provided under both keys so a spec can `TestBed.inject(FakeEntitySession)` to reach the
 * test-only helpers and the View resolves the same instance through {@link ENTITY_SESSION}.
 */
export function provideFakeEntitySession(): Provider[] {
  return [FakeEntitySession, { provide: ENTITY_SESSION, useExisting: FakeEntitySession }];
}
