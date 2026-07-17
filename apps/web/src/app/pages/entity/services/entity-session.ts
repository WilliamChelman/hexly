import { computed, DestroyRef, Injectable, Injector, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  catchError,
  concat,
  defer,
  EMPTY,
  filter,
  finalize,
  ignoreElements,
  map,
  Observable,
  switchMap,
  take,
  tap,
  timeout,
} from 'rxjs';
import {
  emptyEntityDocument,
  EntityDetail,
  EntitySaveOutcome,
  EntityType,
  EntityDocument,
  Visibility,
  withFieldDefaults,
  writeField,
} from '@hexly/domain';
import {
  EntitiesClient,
  ActiveWorld,
  idFromSegment,
  worldRoute,
  TitleService,
  AppShellStore,
  EVICTED,
} from '@hexly/web-core';
import { applyPatches as immerApplyPatches, Draft, Patch, produceWithPatches } from '@hexly/immer';
import type { EntitySession as EntitySessionPort, LiveEditor } from '@hexly/web-entity';
import { PluginRegistry } from '../../../entity-types/plugin-registry';
import { TypeRegistry } from '../../../entity-types/type-registry';

/**
 * The central mutable store for the open Entity (ADR-0048): the concrete
 * {@link EntitySessionPort}. Owns the working document every View edits through {@link mutate},
 * and bridges it to {@link EntitiesClient} for `/entities/:id` — load, autosave, conflict,
 * live-follow. Views bind to it through the {@link ENTITY_SESSION} token.
 *
 * Route-scoped (`providers`), not root: leaving the route destroys it, so
 * open-Entity state resets implicitly.
 */
/** Trailing-debounce window before an edit is autosaved. */
const AUTOSAVE_DELAY_MS = 800;

/**
 * Ceiling on how long a leave-flush blocks navigation — on timeout the route change proceeds
 * and the edit is best-effort lost, same as the `beforeunload` path.
 */
const FLUSH_TIMEOUT_MS = 10_000;

/** The savable payload references captured at one instant. */
interface SaveSnapshot {
  doc: EntityDocument;
  tags: readonly string[];
  types: readonly EntityType[];
  /** True when the type set was authored this session — only then does the save carry `types`. */
  typesChanged: boolean;
  /** The directly-attached Field ids (ADR-0054). */
  fields: readonly string[];
  /** True when an attach/detach happened this session — only then does the save carry `fields`. */
  fieldsChanged: boolean;
}

@Injectable()
export class EntitySession implements EntitySessionPort {
  private readonly entities = inject(EntitiesClient);
  private readonly title = inject(TitleService);
  private readonly router = inject(Router);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly shell = inject(AppShellStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly typeRegistry = inject(TypeRegistry);
  private readonly plugins = inject(PluginRegistry);

  private readonly _current = signal<EntityDetail | null>(null);
  readonly current = this._current.asReadonly();

  /**
   * The working **Entity Document** (ADR-0051) — the one store every View writes to:
   * read a slice off {@link doc}, write through {@link mutate}. The prose editor is no exception,
   * committing its live doc into its `content` Field key on a debounce, so there is no separate buffer.
   */
  private readonly _doc = signal<EntityDocument>(emptyEntityDocument());
  readonly doc = this._doc.asReadonly();

  /**
   * Bumped on a *fresh* load — a new Entity adopted, or the canvas cleared for a route
   * swap — never on a {@link mutate}. A View watches it to reset the transient state tied
   * to the old document (a map editor's undo history and selection); an edit leaves it be.
   */
  private readonly _loadGeneration = signal(0);
  readonly loadGeneration = this._loadGeneration.asReadonly();

  private readonly _conflict = signal<EntityDetail | null>(null);
  /** The server's current Entity when a save was rejected as stale, else `null`. */
  readonly conflict = this._conflict.asReadonly();

  private readonly _error = signal<'save' | 'reload' | 'readonly' | null>(null);
  readonly error = this._error.asReadonly();

  /**
   * The followed Entity became unreachable mid-view (made private, un-shared, or
   * deleted — the nudge said only `unavailable`). Cleared when the next load
   * starts. Eviction also prunes the ref from the interest set, so a later
   * re-share is *not* discovered live. Distinct from {@link error}: nothing
   * failed, the view was evicted, so the page renders an unavailable state.
   */
  private readonly _evicted = signal(false);
  readonly evicted = this._evicted.asReadonly();

  /**
   * Whether the load-time Rights carry the `edit` verb (ADR-0037). False → a read-only
   * opener: {@link save} no-ops so no autosave ever hits a 403 wall.
   */
  readonly writable = computed(() => !!this._current()?.rights?.includes('edit'));

  /**
   * Whether the caller may manage this Entity's sharing (the `manage` verb): a writer who
   * isn't an Owner carries `edit` but not `manage`.
   */
  readonly manageable = computed(() => !!this._current()?.rights?.includes('manage'));

  /**
   * Registered live editors (the prose editor): {@link dirty} counts their pending docs and {@link save}
   * flushes them first (ADR-0051). A signal, so {@link anyEditorPending} recomputes as the set changes.
   */
  private readonly _editors = signal<readonly LiveEditor[]>([]);

  /** Live Tags: ride the version-checked save alongside the document. */
  private readonly _tags = signal<readonly string[]>([]);
  readonly tags = this._tags.asReadonly();

  /** The live, ordered type set (`types[0]` primary), updated before any save. */
  private readonly _types = signal<readonly EntityType[]>([]);
  readonly types = this._types.asReadonly();

  /**
   * The Entity's directly-attached Field ids (`fields[]`, ADR-0054), read into the effective set and
   * authored live by {@link attachField}/{@link detachField}. Rides the version-checked save when it
   * has moved off {@link _baseFields}, mirroring the type set.
   */
  private readonly _fields = signal<readonly string[]>([]);
  readonly fields = this._fields.asReadonly();

  private readonly _saving = signal(false);
  readonly saving = this._saving.asReadonly();

  /**
   * The last-persisted reference of each savable input, captured on load and reset to the *sent*
   * snapshot after a clean save. {@link dirty} derives by reference equality against these — sound
   * because immer only yields a new document reference on a real edit.
   */
  private readonly _baseDoc = signal<EntityDocument | null>(null);
  private readonly _baseTags = signal<readonly string[]>([]);
  private readonly _baseTypes = signal<readonly EntityType[]>([]);
  private readonly _baseFields = signal<readonly string[]>([]);

  /** Whether any live editor holds an uncommitted doc — ORed into {@link dirty} so the save chip stays honest mid-typing (ADR-0051). */
  private readonly anyEditorPending = computed(() => this._editors().some((e) => e.hasPendingCommit()));

  /** True when any savable input has moved off its baseline; false with none open. */
  readonly dirty = computed(
    () =>
      this._current() !== null &&
      (this._doc() !== this._baseDoc() ||
        this.anyEditorPending() ||
        this._tags() !== this._baseTags() ||
        this._types() !== this._baseTypes() ||
        this._fields() !== this._baseFields()),
  );

  /**
   * The open Entity's id, or `null` with none open / a public reader. Drives live-follow:
   * the reconciler switches its server subscription to this id.
   */
  private readonly _followedId = computed(() => (this.externallyDriven ? null : (this._current()?.id ?? null)));

  /**
   * Route load in flight. `current` still holds the previous Entity until the new
   * one resolves, so writes are blocked — a header can't rename/save onto the
   * Entity the user just navigated away from.
   */
  private readonly _loading = signal(false);

  /**
   * Payload of the last failed save. While it stands unchanged, the autosave
   * scheduler is paused — a fresh edit (new reference) or manual Retry clears it,
   * so a failing PUT can't self-retry every 800ms. Plain fields, not signals: the
   * live editor references (already scheduler deps) decide when the pause lifts.
   */
  private failed: SaveSnapshot | null = null;

  constructor() {
    // One owner for the tab title across every view this route dispatches to.
    effect(() => this.title.setDocumentName(this._current()?.name ?? null));
    this.destroyRef.onDestroy(() => this.title.setDocumentName(null));

    // Route-leave flush is awaited by the CanDeactivate guard, not fired here —
    // onDestroy runs too late to block navigation, so the guard calls flush() up front.

    // Tab close / refresh / external nav tears the page down before any async save
    // can land: warn the browser so the user can stay and let autosave finish.
    const beforeUnload = (event: BeforeUnloadEvent) => {
      // Flush editors first, so `dirty` reflects keystrokes still in the debounce window (ADR-0051).
      this.flushEditors();
      // preventDefault() triggers the unsaved-changes prompt in every current browser.
      if (this.dirty()) event.preventDefault();
    };
    // Cmd/Ctrl+S flushes now instead of waiting out the debounce, and suppresses the
    // browser's "save page" dialog — muscle memory still works without a button.
    const keydown = (event: KeyboardEvent) => {
      // toLowerCase: with Caps Lock or Shift held the key is 'S', still a save.
      if (event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.save(true).subscribe();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('keydown', keydown);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('keydown', keydown);
    });

    // Autosave scheduler. Reading the live edit signals — not just dirty() —
    // re-arms the trailing debounce on every keystroke (dirty() stays true, so it
    // alone wouldn't re-fire the effect). Single-flight: saving() gates while one
    // is in flight; when it clears, a still-dirty Entity re-arms here. Paused on
    // conflict, during route load, and after a failed save until the payload
    // changes — else _saving flipping false would retry the same failing PUT.
    effect((onCleanup) => {
      this._doc();
      this.anyEditorPending();
      this._tags();
      this._types();
      this._fields();
      const armed = this.dirty() && !this._conflict() && !this._saving() && !this._loading() && !this.unsavedFailure();
      if (!armed) return;
      const timer = setTimeout(() => this.save().subscribe(), AUTOSAVE_DELAY_MS);
      onCleanup(() => clearTimeout(timer));
    });

    // Live-follow reconciler: the client's write-through store owns the source; we only decide
    // what to *apply*. `switchMap` off the followed id makes the follow subscription-scoped —
    // swapping Entity tears down the old follow, `takeUntilDestroyed` withdraws on route leave.
    toObservable(this._followedId)
      .pipe(
        // A computed already dedupes on ===, so toObservable only emits on a real id change.
        switchMap((id) => (id === null ? EMPTY : this.entities.watch(id))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        // EVICTED: our access ended (un-shared / deleted / a 403·404 refetch). Blank the view —
        // but never over unsaved edits: a dirty editor keeps its buffer and meets the access loss
        // at save time (403 → read-only) instead. Nulling current also nulls _followedId, so the
        // switchMap tears the follow down.
        if (result === EVICTED) {
          if (!this.dirty()) this.evict();
          return;
        }
        // Adopt a fresh detail from another writer — never over unsaved edits or a route load, and
        // only if newer than held. The store's write-through fans our *own* save back at the same
        // version; `newerThanHeld` drops that echo so it never re-seeds the editor mid-session.
        if (!this.dirty() && !this._loading() && this.newerThanHeld(result)) this.adopt(result);
      });
  }

  /** {@link watchRoute}: the caller passes its ActivatedRoute in — a route-scoped service would get the root injector's route. */
  /**
   * A Public Link page fetches its Entity through the token-scoped public read
   * surface and {@link adopt}s it directly. Marking the session externally driven
   * makes {@link watchRoute} a no-op, so the reused {@link EntityPage} can't
   * *also* fire an authenticated `/api/entities/:id` load.
   */
  private externallyDriven = false;
  markExternallyDriven(): void {
    this.externallyDriven = true;
  }

  watchRoute(route: ActivatedRoute): void {
    // A public reader already has its Entity — never fire an authenticated load over it.
    if (this.externallyDriven) return;
    route.paramMap
      .pipe(
        map((params) => params.get('id')),
        filter((seg): seg is string => seg !== null),
        map((seg) => idFromSegment(seg)),
        switchMap((id) =>
          this.openRoute(id).pipe(
            catchError((err) => {
              if (err instanceof HttpErrorResponse && err.status === 404) {
                const worldId = this.activeWorld.worldId();
                this.router.navigate(worldId ? worldRoute(worldId) : ['/']);
              } else {
                this._error.set('reload');
              }
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  open(id: string): Observable<EntityDetail> {
    return this.entities.load(id).pipe(tap((detail) => this.adopt(detail)));
  }

  /**
   * Whether a freshly-emitted detail is newer than the view holds (ADR-0045) — the adopt gate that
   * drops the store's echo of our own save. `seq` is the freshness key, bumped by *every* committed
   * change; comparing `(version, updatedAt)` instead would drop the changes that deliberately move
   * neither — a grant, an ownership change, a visibility flip — so a demoted Editor would keep
   * rendering a Save button until some unrelated edit finally moved the version.
   */
  private newerThanHeld(d: EntityDetail): boolean {
    const held = this._current();
    return !!held && d.seq > held.seq;
  }

  /** Blank the view on live eviction (#174): the unavailable state, not an error or a redirect. */
  private evict(): void {
    this._evicted.set(true);
    this._current.set(null);
  }

  adopt(detail: EntityDetail): void {
    this._conflict.set(null);
    this._error.set(null);
    this._evicted.set(false);
    this.failed = null;
    this._current.set(detail);
    this._doc.set(detail.document); // the working document — prose, grid, and all — is the loaded document
    this._tags.set(detail.tags);
    this._types.set(detail.types);
    this._fields.set(detail.fields ?? []); // attached Fields ride the load into the effective set (ADR-0054)
    // Baseline = exactly the references now live, so a load never reads as dirty.
    this._baseDoc.set(this._doc());
    this._baseTags.set(this._tags());
    this._baseTypes.set(this._types());
    this._baseFields.set(this._fields());
    // A fresh Entity: reset every View's document-tied transient state (a map's undo/selection, the
    // prose editor's live doc) — the loadGeneration tick a live editor watches to re-seed.
    this._loadGeneration.update((n) => n + 1);
    // Live-follow tracks the open Entity reactively off _current (see the reconciler), so adopt
    // needs no follow bookkeeping — swapping id re-points the subscription on its own.
  }

  /**
   * Carry the caller's load-time Rights (ADR-0039) onto an in-place update response. A
   * save/rename returns the Entity *without* `rights` — the server computes Rights only on read —
   * and never changes the caller's standing, so we preserve them from the pre-mutation Entity.
   * Dropping them would flip an Owner read-only (no `edit` verb) and hide the owner-only Share
   * action (no `manage`) the moment they save. A *visibility* PATCH is the exception: it can
   * revoke the caller's own access (a World Owner loses write when a shared Entity goes private),
   * so the server ships fresh `rights` on that response and we prefer them over the stale set.
   */
  private withPermissions(updated: EntityDetail, prev: EntityDetail): EntityDetail {
    return { ...updated, rights: updated.rights ?? prev.rights };
  }

  /** Replace the live tags (#72); the next save persists them version-checked. */
  setTags(tags: readonly string[]): void {
    this._tags.set(tags);
  }

  /**
   * Replace the live type set, `types[0]` primary (#189). {@link withFieldDefaults} mints the
   * defaults the new set's Fields declare — so adding `core.hexmap` gives the map View an empty
   * plane at `grid` to open on (ADR-0050). Additive: dropping a type never strips its values.
   */
  setTypes(types: readonly EntityType[]): void {
    this._types.set([...types]);
    this.mintFieldDefaults(types, this._fields());
  }

  /**
   * Attach a registered **Field** directly to the open Entity (`fields[]`, ADR-0054, #229) — the
   * additive instance layer that lets one Entity carry a Field its types never named. A no-op if
   * already attached. Mints the new Field's default so its View has something to open on (a Field of a
   * Structured Data Type gets its empty plane); a built-in Field renders as an empty control. The next
   * save persists the set version-checked.
   */
  attachField(id: string): void {
    if (this._fields().includes(id)) return;
    const next = [...this._fields(), id];
    this._fields.set(next);
    this.mintFieldDefaults(this._types(), next);
  }

  /**
   * Detach a directly-attached Field (#229), clearing its value from the one EntityDocument map — a
   * directly-attached Field owns its key, unlike a removed type (which leaves its values behind,
   * CONTEXT.md → Field). A no-op if not attached. The next save persists the set version-checked.
   */
  detachField(id: string): void {
    if (!this._fields().includes(id)) return;
    // Resolve the key from the World-Field-aware registry first (a `world.*` Field is owned by no
    // Plugin, so `PluginRegistry` alone cannot clear it), falling back to the raw plugin definition so
    // a *disabled* plugin's degraded Field still clears its value. Only a plugin this build never
    // bundled leaves an orphan (there is no lens to say which key it owned).
    const field = this.typeRegistry.field(id) ?? this.plugins.fieldDefinition(id);
    this._fields.set(this._fields().filter((f) => f !== id));
    if (field) this._doc.set(writeField(this._doc(), field, undefined));
  }

  /**
   * Mint the defaults the effective Field set declares into the working document (ADR-0050/0054): a
   * Field of a Structured Data Type gets its empty plane, so the map View opens on a plane not a blank
   * frame. Additive — it never strips a value, so dropping a type or detaching a Field leaves the rest.
   */
  private mintFieldDefaults(types: readonly EntityType[], fieldIds: readonly string[]): void {
    const fields = this.typeRegistry.effectiveFields(types, fieldIds);
    const reconciled = withFieldDefaults(this._doc(), fields, this.plugins.structuredDataTypes);
    if (reconciled !== this._doc()) this._doc.set(reconciled);
  }

  /**
   * Run `recipe` against a draft of the document through Immer, adopting the result and returning
   * the forward/inverse patches (ADR-0048) — a View that owns undo/redo keeps them to replay.
   * Bumps no load generation: an edit must not reset a View's history.
   */
  mutate(recipe: (draft: EntityDocument) => void): {
    redo: Patch[];
    undo: Patch[];
  } {
    const [next, redo, undo] = produceWithPatches(this._doc(), recipe as (draft: Draft<EntityDocument>) => void);
    this._doc.set(next as EntityDocument);
    return { redo, undo };
  }

  /** Apply raw patches to the document — the undo/redo channel a View replays its own stack through. */
  applyPatches(patches: Patch[]): void {
    this._doc.set(immerApplyPatches(this._doc(), patches));
  }

  /**
   * Register a live editor so {@link dirty} counts its uncommitted doc and a save flushes it first
   * (ADR-0051). Returns an unregister callback for teardown.
   */
  registerEditor(editor: LiveEditor): () => void {
    this._editors.update((editors) => [...editors, editor]);
    return () => this._editors.update((editors) => editors.filter((e) => e !== editor));
  }

  /** Fold every live editor's pending doc into the working document — before a save snapshot is taken. */
  private flushEditors(): void {
    for (const editor of this._editors()) editor.flushPendingCommit();
  }

  /** Always a fresh fetch: the session outlives library trips, so a cached `current` can be stale (#70). */
  openRoute(id: string): Observable<EntityDetail> {
    // Flush the previous Entity AND WAIT before clearing its canvas (ADR-0026): an in-app
    // swap reuses this route-scoped session, so the edit must land while the live signals
    // still hold it — clearing first would drop a debounced edit. flush() also drains any
    // in-flight autosave so a mid-save edit rides a follow-up under the advanced version.
    return concat(
      this.flush().pipe(ignoreElements()),
      defer(() => {
        this._doc.set(emptyEntityDocument()); // clear the previous canvas and prose during load (#7)
        this._tags.set([]); // and the previous Entity's tags, which ride the same load (#88)
        this._types.set([]); // and its type set, re-baselined below so the blank load isn't dirty
        this._fields.set([]); // and its attached Fields, which ride the same load (ADR-0054)
        // A cleared canvas is a fresh start: reset the Views' document-tied state (#7) — the same
        // bump adopt() makes, so a load that never resolves still leaves no stale map state, and
        // the prose editor re-seeds off the emptied document.
        this._loadGeneration.update((n) => n + 1);
        // Re-baseline onto the cleared placeholder so the load window isn't dirty — else a
        //404 redirect (which clears then leaves) would flush this empty state over the
        // Entity the user just left (ADR-0026).
        this._baseDoc.set(this._doc());
        this._baseTags.set(this._tags());
        this._baseTypes.set(this._types());
        this._baseFields.set(this._fields());
        // Eviction belongs to the Entity just left (#174): clear it as the new load starts —
        // waiting for a successful adopt() would let it mask this load's own failure state.
        this._evicted.set(false);
        this._loading.set(true);
        return this.open(id).pipe(
          this.shell.withLoading('subtle'),
          finalize(() => this._loading.set(false)),
        );
      }),
    );
  }

  /** Rename the open Entity (metadata only — does not affect the document save). */
  rename(name: string): Observable<EntityDetail> {
    return this.patch({ name });
  }

  /** Flip the open Entity's Visibility (ADR-0037, #160) — metadata only, like {@link rename}. */
  setVisibility(visibility: Visibility): Observable<EntityDetail> {
    return this.patch({ visibility });
  }

  /**
   * The shared metadata PATCH behind {@link rename} and {@link setVisibility}. Exactly one of
   * the two rides a request (ADR-0045), which is what lets the kind pick the server's gate.
   * None open, or one loading under navigation → no-op (not a throw), so a stale patch
   * can't write to the Entity the user navigated away from.
   */
  private patch(changes: { name: string } | { visibility: Visibility }): Observable<EntityDetail> {
    const open = this._current();
    if (!open || this._loading()) return EMPTY;
    return this.entities.patch(open.id, changes).pipe(
      tap((updated) => {
        this._current.set(this.withPermissions(updated, open));
        this._conflict.set(null); // fresh state clears any stale 409 chip
      }),
    );
  }

  /**
   * Save the editor's live snapshot under the open Entity's base version. `showLoading`
   * raises the shell's subtle spinner — on for explicit Cmd/Ctrl+S and Retry, off for the
   * background autosave/leave flushes that fire on every debounce, so the spinner doesn't
   * flicker on the editing hot path (ADR-0026).
   */
  save(showLoading = false): Observable<EntitySaveOutcome> {
    // None open, or one loading under navigation → no-op: avoids sticking `_saving`
    // on "Saving…" or writing to the wrong Entity (#4). Already saving → no-op too, so
    // a Cmd+S or flush can't start a second concurrent write (the scheduler coalesces
    // mid-flight edits into one follow-up once this resolves, ADR-0026).
    const open = this._current();
    if (!open || this._loading() || this._saving()) return EMPTY;
    // Read-only opener → no write is ever attempted (the root of the stuck-banner bug):
    // gating here covers every path (autosave scheduler, Cmd/Ctrl+S, leave flush).
    if (!this.writable()) return EMPTY;
    // Flush every live editor into the document *before* snapshotting, so keystrokes still in the
    // debounce window ride this save instead of being eaten by it (ADR-0051).
    this.flushEditors();
    // Snapshot the exact references being sent. A clean save advances the baseline to
    // *these*, not the live signals, so keystrokes that land mid-flight stay dirty and
    // ride the next save instead of being silently marked clean (ADR-0026).
    return this.runSave(
      open,
      {
        doc: this._doc(),
        tags: this._tags(),
        types: this._types(),
        typesChanged: this._types() !== this._baseTypes(),
        fields: this._fields(),
        fieldsChanged: this._fields() !== this._baseFields(),
      },
      showLoading,
    );
  }

  /** The version-checked PUT for a captured snapshot; callers own the gating. */
  private runSave(open: EntityDetail, snapshot: SaveSnapshot, showLoading: boolean): Observable<EntitySaveOutcome> {
    this._saving.set(true);
    this._error.set(null);
    this.failed = null;
    const { doc, tags, types, typesChanged, fields, fieldsChanged } = snapshot;
    // The document already carries every edit — prose, grid, and all — since every View writes through
    // `mutate` (ADR-0051). Send `types`/`fields` only when this edit authored them, so a plain document
    // save never re-types data at rest nor re-sends an at-rest attachment set (ADR-0048/0054).
    const request$ = fieldsChanged
      ? this.entities.save(open.id, doc, open.version, tags, typesChanged ? types : undefined, fields)
      : typesChanged
        ? this.entities.save(open.id, doc, open.version, tags, types)
        : this.entities.save(open.id, doc, open.version, tags);
    const save$ = request$.pipe(
      tap((outcome) => {
        // Drop a late response if the user has since navigated to another Entity — it
        // must not write its result over the Entity now open (generalises #4/#70).
        if (this._current()?.id !== open.id) return;
        // On conflict, leave the open Entity untouched so the edit survives until
        // a re-pull; only a clean save advances it.
        if (outcome.status === 'conflict') {
          this._conflict.set(outcome.current);
        } else {
          this._conflict.set(null);
          this._current.set(this.withPermissions(outcome.entity, open));
          this._baseDoc.set(doc);
          this._baseTags.set(tags);
          this._baseTypes.set(types);
          this._baseFields.set(fields);
        }
      }),
      catchError((err: unknown) => {
        // A 403 means write permission was lost server-side (a shared Entity re-hidden or
        // a role revoked mid-session): a terminal read-only state, not a retryable blip —
        // the chip offers no Retry. `failed` still pauses the scheduler so it can't loop
        // the same rejected PUT every 800ms (it only re-attempts once per fresh edit).
        this._error.set(err instanceof HttpErrorResponse && err.status === 403 ? 'readonly' : 'save');
        this.failed = snapshot;
        return EMPTY;
      }),
      finalize(() => this._saving.set(false)),
    );
    return showLoading ? save$.pipe(this.shell.withLoading('subtle')) : save$;
  }

  /**
   * Persist a pending edit on the way out and complete when it has landed — awaited by the
   * route swap (openRoute) and the CanDeactivate guard (ADR-0026), so an in-app leave never
   * drops a debounced edit. Waits out any in-flight autosave first (its result advances the
   * version), then sends the latest snapshot. A clean Entity or an unresolved conflict (a
   * stale base version would just 409) completes immediately. Bounded by FLUSH_TIMEOUT_MS so
   * a hung network can't trap the user on the page.
   */
  flush(): Observable<unknown> {
    return this.pendingSave().pipe(timeout({ first: FLUSH_TIMEOUT_MS, with: () => EMPTY }));
  }

  private pendingSave(): Observable<unknown> {
    // A save is in flight: wait for _saving to clear, then re-check and send the remainder.
    if (this._saving()) {
      return toObservable(this._saving, { injector: this.injector }).pipe(
        filter((saving) => !saving),
        take(1),
        switchMap(() => this.pendingSave()),
      );
    }
    if (this._conflict() || this._loading() || !this.dirty()) return EMPTY;
    return this.save();
  }

  /** True while a save error stands and the payload hasn't been edited since (ADR-0026). */
  private unsavedFailure(): boolean {
    const failed = this.failed;
    return (
      failed !== null &&
      this._doc() === failed.doc &&
      this._tags() === failed.tags &&
      this._types() === failed.types &&
      this._fields() === failed.fields
    );
  }

  /** Conflict resolution (#6): accept the server's version, discarding the rejected local edit. */
  reload(): Observable<EntityDetail> {
    // Real GET via `open()` — the conflict re-pull must not be cached (#4).
    const open = this._current();
    if (!open) return EMPTY;
    this._error.set(null);
    return this.open(open.id).pipe(
      catchError(() => {
        this._error.set('reload');
        return EMPTY;
      }),
    );
  }
}
