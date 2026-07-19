import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, switchMap, tap } from 'rxjs';
import { EntityDetail, EntityDocument, EntityType, emptyEntityDocument } from '@hexly/domain';
import { applyPatches as immerApplyPatches, Draft, Patch, produceWithPatches } from '@hexly/immer';
import { EntitiesClient, EVICTED } from '@hexly/web-core';
import type { EntitySession as EntitySessionPort, LiveEditor } from '@hexly/web-entity';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { EntitySession } from './entity-session';

/**
 * The read-only session behind a **Board Embed**'s live transclusion (ADR-0062, #270): a lightweight
 * {@link EntitySession} the Entity View Outlet drives when it renders *another* Entity in place. The
 * full route session owns autosave, the tab title, live-follow and conflict machinery — a fresh one per
 * Embed would clobber the open page's title and spin up N autosave loops — so an Embed gets this stripped
 * twin instead: it loads a target once, holds its document for the transcluded View to read, and is
 * **never writable**, so the View mounts read-only and no edit ever routes here.
 *
 * Provided (aliased to both the concrete {@link EntitySession} and the `ENTITY_SESSION` token) by the
 * Embed host that mounts the outlet, so the outlet and the transcluded View resolve *this* session — not
 * the page's — for the Embed's own target.
 */
@Injectable()
export class EmbedEntitySession implements EntitySessionPort {
  private readonly entities = inject(EntitiesClient);
  private readonly typeRegistry = inject(TypeRegistry);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _current = signal<EntityDetail | null>(null);
  readonly current = this._current.asReadonly();

  private readonly _doc = signal<EntityDocument>(emptyEntityDocument());
  readonly doc = this._doc.asReadonly();

  private readonly _types = signal<readonly EntityType[]>([]);
  readonly types = this._types.asReadonly();

  private readonly _loadGeneration = signal(0);
  readonly loadGeneration = this._loadGeneration.asReadonly();

  /**
   * Never writable — an Embed is read-only transclusion (ADR-0062): editing the target's substance means
   * opening the target, never editing through the Embed, so the transcluded View shows no editing chrome.
   */
  readonly writable = computed(() => false);

  /** The target's directly-attached Field ids (ADR-0057), derived off the loaded document and type set. */
  readonly fields = computed(() => {
    const doc = this._doc();
    const typeDefaultIds = new Set(this.typeRegistry.resolveFields(this._types()).map((field) => field.id));
    return Object.keys(doc).filter((key) => !typeDefaultIds.has(key) && this.typeRegistry.field(key) !== undefined);
  });

  /** The Embed's followed target id, off the loaded detail — drives the live-follow subscription. */
  private readonly _followedId = computed(() => this._current()?.id ?? null);

  constructor() {
    // Live-follow the Embed's target (ADR-0044/0062): a read-only transclusion mirrors the target's
    // *committed* changes rather than freezing at load time. Never writable, so there are no local edits
    // to protect (the full session's clobber guard) — every fresh detail is adopted. `switchMap` off the
    // followed id tears the old follow down when the Embed re-points to another target, and
    // `takeUntilDestroyed` withdraws it when the host outlet unmounts. EVICTED (the target un-shared or
    // deleted mid-view) blanks the held detail so no stale substance lingers behind the transclusion.
    toObservable(this._followedId)
      .pipe(
        switchMap((id) => (id === null ? EMPTY : this.entities.watch(id))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (result === EVICTED) {
          this._current.set(null);
          return;
        }
        this.adopt(result);
      });
  }

  /**
   * Load the Embed's target and adopt its document; a fetch error (403/404) surfaces to the outlet
   * (dangling). Adopting sets {@link current}, which the live-follow reconciler tracks to begin following
   * the target's committed changes (ADR-0044).
   */
  open(id: string): Observable<EntityDetail> {
    return this.entities.load(id).pipe(tap((detail) => this.adopt(detail)));
  }

  private adopt(detail: EntityDetail): void {
    this._current.set(detail);
    this._doc.set(detail.document);
    this._types.set(detail.types);
    // A fresh target: bump the generation a document-tied View watches to reset its transient state.
    this._loadGeneration.update((n) => n + 1);
  }

  /**
   * Present so a transcluded View (a nested Board, a map) can bind the session port, though a read-only
   * Embed never commits — the View's editing paths are gated on {@link writable}. Kept faithful to the
   * real session's semantics rather than a throwing stub.
   */
  mutate(recipe: (draft: EntityDocument) => void): { redo: Patch[]; undo: Patch[] } {
    const [next, redo, undo] = produceWithPatches(this._doc(), recipe as (draft: Draft<EntityDocument>) => void);
    this._doc.set(next as EntityDocument);
    return { redo, undo };
  }

  applyPatches(patches: Patch[]): void {
    this._doc.set(immerApplyPatches(this._doc(), patches));
  }

  /** A read-only transclusion flushes nothing on save, so registration is inert — return a no-op unregister. */
  registerEditor(_editor: LiveEditor): () => void {
    return () => undefined;
  }
}
