import {
  computed,
  DestroyRef,
  Injectable,
  Injector,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  catchError,
  concat,
  defer,
  distinctUntilChanged,
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
  Content,
  emptyHexMap,
  EntityBody,
  EntityDetail,
  EntitySaveOutcome,
  hasHexGrid,
  HexMap,
  hexMapSchema,
  tiptapContent,
  Visibility,
} from '@hexly/domain';
import { EntitiesClient, ActiveWorld, idFromSegment, worldRoute, TitleService, AppShellStore, EVICTED } from '@hexly/web-core';
import { EntityView, HexMapStore } from '@hexly/web-map';
import type { ContentEditorSession } from '@hexly/content-editor';

/**
 * Bridges {@link EntitiesClient} and {@link HexMapStore} for `/entities/:id`:
 * unwraps the stored grid on open, re-wraps it on save.
 *
 * Route-scoped (`providers`), not root: leaving the route destroys it, so
 * open-Entity state resets implicitly.
 */
/** Trailing-debounce window before an edit is autosaved. */
const AUTOSAVE_DELAY_MS = 800;

/**
 * Ceiling on how long a leave-flush blocks navigation — only bites a hung
 * network, where we stop waiting and let the route change proceed (the edit is
 * best-effort lost, same as the `beforeunload` path).
 */
const FLUSH_TIMEOUT_MS = 10_000;

/** The savable payload references captured at one instant. */
interface SaveSnapshot {
  grid: HexMap;
  content: Content;
  tags: readonly string[];
}

@Injectable()
export class EntitySession implements ContentEditorSession {
  private readonly entities = inject(EntitiesClient);
  private readonly editor = inject(HexMapStore);
  private readonly title = inject(TitleService);
  private readonly router = inject(Router);
  private readonly activeWorld = inject(ActiveWorld);
  private readonly shell = inject(AppShellStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  private readonly _current = signal<EntityDetail | null>(null);
  readonly current = this._current.asReadonly();

  private readonly _conflict = signal<EntityDetail | null>(null);
  /** The server's current Entity when a save was rejected as stale, else `null`. */
  readonly conflict = this._conflict.asReadonly();

  /** Fires on load, conflict reload, note swap — NOT clean saves/renames, so in-flight keystrokes aren't discarded. */
  private readonly _seed = signal<EntityDetail | null>(null);
  readonly seed = this._seed.asReadonly();

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
   * Whether the load-time Rights carry the `edit` verb. False → a read-only
   * opener: {@link save} no-ops so no autosave ever hits a 403 wall.
   */
  readonly writable = computed(() => !!this._current()?.rights?.includes('edit'));

  /**
   * Whether the caller may manage this Entity's sharing (the `manage` verb) —
   * gates the owner-only Share surface; a writer who isn't an Owner carries
   * `edit` but not `manage`.
   */
  readonly manageable = computed(() => !!this._current()?.rights?.includes('manage'));

  /** Live Content envelope; here not in {@link HexMapStore} since Content spans every Entity type. */
  private readonly _content = signal<Content | null>(null);
  /**
   * Live Content for an editor to seed from on (re)mount. Unlike {@link seed} it
   * carries edits since load, so an editor recreated mid-session restores the
   * latest prose, not the loaded snapshot.
   */
  readonly content = this._content.asReadonly();

  /**
   * Live Tags: span every Entity type and ride the version-checked save, so a
   * body-only save never silently drops them.
   */
  private readonly _tags = signal<readonly string[]>([]);
  readonly tags = this._tags.asReadonly();

  private readonly _saving = signal(false);
  readonly saving = this._saving.asReadonly();

  /**
   * The last-persisted reference of each savable input, captured on load and
   * reset to the *sent* snapshot after a clean save. {@link dirty} derives by
   * reference equality against these — sound because immer and TipTap-minted
   * Content only yield a new reference on a real edit.
   */
  private readonly _baseGrid = signal<HexMap | null>(null);
  private readonly _baseContent = signal<Content | null>(null);
  private readonly _baseTags = signal<readonly string[]>([]);

  /** True when any savable input has moved off its baseline; false with none open. */
  readonly dirty = computed(
    () =>
      this._current() !== null &&
      (this.editor.document() !== this._baseGrid() ||
        this._content() !== this._baseContent() ||
        this._tags() !== this._baseTags()),
  );

  /**
   * The open Entity's id, or `null` with none open / a public reader. Drives
   * live-follow: the reconciler switches its server subscription to this id, so a
   * swap unfollows the old and follows the new without manual bookkeeping.
   */
  private readonly _followedId = computed(() =>
    this.externallyDriven ? null : this._current()?.id ?? null,
  );

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
      this.editor.document();
      this._content();
      this._tags();
      const armed =
        this.dirty() &&
        !this._conflict() &&
        !this._saving() &&
        !this._loading() &&
        !this.unsavedFailure();
      if (!armed) return;
      const timer = setTimeout(() => this.save().subscribe(), AUTOSAVE_DELAY_MS);
      onCleanup(() => clearTimeout(timer));
    });

    // Live-follow reconciler: the client's write-through store owns the source (shared follow +
    // debounced refetch + freshness dedup, fed by our own saves too); we only decide what to *apply*.
    // `switchMap` off the followed id makes it subscription-scoped — swapping Entity tears down the
    // old follow, `takeUntilDestroyed` withdraws on route leave.
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

  /**
   * Caller passes its ActivatedRoute in — a route-scoped service would get the
   * root injector's route. switchMap keeps a stale A response off B's canvas;
   * 404 → the World's library; other load errors set the reload-error state.
   */
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

    // Editor surface lives in the URL: refresh/shared link restores the view,
    // opening another Entity (no `view` param) resets to the grid.
    route.queryParamMap
      .pipe(
        map((q): EntityView => (q.get('view') === 'note' ? 'note' : 'map')),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((view) => this.editor.setView(view));
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
    this._content.set(detail.document.content); // before seed: seed effect reads content()
    this._seed.set(detail);
    this._tags.set(detail.tags);
    this.editor.load(gridOf(detail.document));
    // Baseline = exactly the references now live, so a load never reads as dirty.
    this._baseGrid.set(this.editor.document());
    this._baseContent.set(this._content());
    this._baseTags.set(this._tags());
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

  /** Wrap the editor's latest snapshot in the format envelope (ADR-0019). */
  setContent(snapshot: unknown): void {
    // TipTap fires `update` on load/schema-normalization, not only on a real edit — and
    // tiptapContent mints a new Content each call. Re-wrapping then would move _content off
    // its baseline reference and trip the reference-equality dirty check into autosaving a PUT
    // with no user change (#164). Collapse a snapshot value-equal to the persisted one back to
    // the baseline reference, so only real prose changes read as dirty (ADR-0005 invariant).
    const base = this._baseContent();
    // ponytail: JSON.stringify equality — ProseMirror JSON has deterministic key order, so this
    // is sound for doc snapshots; swap for a deep-equal if snapshot ever holds non-PM data.
    if (base && JSON.stringify(snapshot) === JSON.stringify(base.snapshot)) {
      this._content.set(base);
      return;
    }
    this._content.set(tiptapContent(snapshot));
  }

  /** Replace the live tags (#72); the next save persists them version-checked. */
  setTags(tags: readonly string[]): void {
    this._tags.set(tags);
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
        this.editor.load(emptyHexMap()); // clear the previous canvas during load (#7)
        this._tags.set([]); // and the previous Entity's tags/content, which ride the same load (#88)
        this._content.set(null);
        // Re-baseline onto the cleared placeholder so the load window isn't dirty — else a
        //404 redirect (which clears then leaves) would flush this empty state over the
        // Entity the user just left (ADR-0026).
        this._baseGrid.set(this.editor.document());
        this._baseContent.set(this._content());
        this._baseTags.set(this._tags());
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

  /** Rename the open Entity (metadata only — does not affect the body save). */
  rename(name: string): Observable<EntityDetail> {
    return this.patch({ name });
  }

  /** Flip the open Entity's Visibility (ADR-0037, #160) — metadata only, like {@link rename}. */
  setVisibility(visibility: Visibility): Observable<EntityDetail> {
    return this.patch({ visibility });
  }

  /**
   * The shared metadata PATCH behind {@link rename} and {@link setVisibility} — both hit
   * the same endpoint and share the same bookkeeping, so the guard lives in one place. Exactly one
   * of the two rides a request (ADR-0045), which is what lets the kind pick the server's gate.
   * None open, or one loading under navigation → no-op (not a throw), so a stale patch
   * can't write to the Entity the user navigated away from (#4).
   */
  private patch(
    changes: { name: string } | { visibility: Visibility },
  ): Observable<EntityDetail> {
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
    // Snapshot the exact references being sent. A clean save advances the baseline to
    // *these*, not the live signals, so keystrokes that land mid-flight stay dirty and
    // ride the next save instead of being silently marked clean (ADR-0026).
    const content = this._content()!;
    return this.runSave(
      open,
      {
        grid: this.editor.document(),
        content,
        tags: this._tags(),
      },
      showLoading,
    );
  }

  /** The version-checked PUT for a captured snapshot; callers own the gating. */
  private runSave(
    open: EntityDetail,
    snapshot: SaveSnapshot,
    showLoading: boolean,
  ): Observable<EntitySaveOutcome> {
    this._saving.set(true);
    this._error.set(null);
    this.failed = null;
    const { grid, content, tags } = snapshot;
    const body = withContent(withGrid(open.document, grid), content);
    const save$ = this.entities
      .save(open.id, body, open.version, tags)
      .pipe(
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
          this._baseGrid.set(grid);
          this._baseContent.set(content);
          this._baseTags.set(tags);
        }
      }),
      catchError((err: unknown) => {
        // A 403 means write permission was lost server-side (a shared Entity re-hidden or
        // a role revoked mid-session): a terminal read-only state, not a retryable blip —
        // the chip offers no Retry. `failed` still pauses the scheduler so it can't loop
        // the same rejected PUT every 800ms (it only re-attempts once per fresh edit).
        this._error.set(
          err instanceof HttpErrorResponse && err.status === 403 ? 'readonly' : 'save',
        );
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
    return this.pendingSave().pipe(
      timeout({ first: FLUSH_TIMEOUT_MS, with: () => EMPTY }),
    );
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
      this.editor.document() === failed.grid &&
      this._content() === failed.content &&
      this._tags() === failed.tags
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

/**
 * The body's hex-grid payload, parsed through {@link hexMapSchema} so the schema picks out the grid
 * fields rather than a hand-listed set; an empty plane when the body carries no hex-grid. Keys off
 * the payload composition ({@link hasHexGrid}) — the body holds no `type` field now (ADR-0048).
 */
function gridOf(body: EntityBody): HexMap {
  return hasHexGrid(body) ? hexMapSchema.parse(body) : emptyHexMap();
}

/**
 * Re-wrap an edited grid into the body on save (ADR-0019). A body with no hex-grid payload passes
 * through as-is, so the hex seam can't graft a grid onto a note.
 */
function withGrid(body: EntityBody, grid: HexMap): EntityBody {
  return hasHexGrid(body) ? { ...body, ...grid } : body;
}

/** Fold the live Content into the body on save (ADR-0019); the spread preserves the payload composition. */
function withContent(body: EntityBody, content: Content): EntityBody {
  return { ...body, content };
}
