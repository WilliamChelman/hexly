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
  HexMap,
  hexMapSchema,
  tiptapContent,
} from '@hexly/domain';
import { JSONContent } from '@tiptap/core';
import { EntitiesClient } from '../../../core/services/entities.client';
import { ActiveWorld } from '../../../core/services/active-world';
import { harvestDescriptors } from '../components/descriptors';
import { TitleService } from '../../../core/i18n/title.service';
import { AppShellStore } from '../../../shell/app-shell.store';
import { EntityView, HexMapStore } from './hexmap-store';

/**
 * Bridges {@link EntitiesClient} and {@link HexMapStore} for `/entities/:id`:
 * unwraps the stored grid on open, re-wraps it (ADR-0019) on save.
 *
 * Route-scoped (`providers`), not root: leaving the route destroys it, so
 * open-Entity state resets implicitly.
 */
/** Trailing-debounce window before an edit is autosaved (ADR-0026). */
const AUTOSAVE_DELAY_MS = 800;

/**
 * Ceiling on how long a leave-flush blocks navigation (ADR-0026). Normal saves finish in
 * well under a second; this only bites a hung network, where we stop waiting and let the
 * route change proceed (the edit is best-effort lost, same as the `beforeunload` path).
 */
const FLUSH_TIMEOUT_MS = 10_000;

/** The savable payload references captured at one instant (ADR-0026). */
interface SaveSnapshot {
  grid: HexMap;
  content: Content;
  tags: readonly string[];
  /** Distinct Link Descriptors harvested from {@link content} (#96) — derived, not a separate signal. */
  descriptors: readonly string[];
}

@Injectable()
export class EntitySession {
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

  private readonly _error = signal<'save' | 'reload' | null>(null);
  readonly error = this._error.asReadonly();

  /** Live Content envelope (ADR-0019); here not in {@link HexMapStore} since Content spans every Entity type. */
  private readonly _content = signal<Content | null>(null);
  /**
   * Live Content for an editor to seed from on (re)mount. Unlike {@link seed} it
   * carries edits since load, so an editor recreated mid-session (Map↔Note toggle,
   * #75) restores the latest prose, not the loaded snapshot.
   */
  readonly content = this._content.asReadonly();

  /**
   * Live Tags (#72): span every Entity type and ride the version-checked save, so a
   * body-only save never silently drops them. Survives a clean save.
   */
  private readonly _tags = signal<readonly string[]>([]);
  readonly tags = this._tags.asReadonly();

  private readonly _saving = signal(false);
  readonly saving = this._saving.asReadonly();

  /**
   * The last-persisted reference of each savable input (grid, Content, Tags), captured
   * on load and reset to the *sent* snapshot after a clean save. {@link dirty} is the
   * single channel: derived by reference equality against these, so a new editing
   * widget can't forget to flag a change — if it mutates a savable signal, dirty sees
   * it (ADR-0026). Reference equality is sound because immer's commit/undo/redo and
   * TipTap-minted Content only yield a new reference on a real edit (ADR-0005).
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
   * Route load in flight. `current` still holds the previous Entity until the new
   * one resolves, so writes are blocked — a header can't rename/save onto the
   * Entity the user just navigated away from.
   */
  private readonly _loading = signal(false);

  /**
   * Payload of the last failed save (ADR-0026). While it stands unchanged, the autosave
   * scheduler is paused — a fresh edit (new reference) or manual Retry clears it, so a
   * failing PUT can't self-retry every 800ms. Plain fields, not signals: the live editor
   * references (already scheduler deps) decide when the pause lifts.
   */
  private failed: SaveSnapshot | null = null;

  constructor() {
    // One owner for the tab title across every view this route dispatches to.
    effect(() => this.title.setDocumentName(this._current()?.name ?? null));
    this.destroyRef.onDestroy(() => this.title.setDocumentName(null));

    // Route-leave flush is awaited by the CanDeactivate guard (ADR-0026), not fired here —
    // onDestroy runs too late to block navigation, so the guard calls flush() up front.

    // Tab close / refresh / external nav tears the page down before any async save can
    // land (ADR-0026): warn the browser so the user can stay and let autosave finish.
    const beforeUnload = (event: BeforeUnloadEvent) => {
      // preventDefault() is the modern trigger for the unsaved-changes prompt; the old
      // event.returnValue is deprecated and every current browser honours this alone.
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

    // Autosave scheduler (ADR-0026). Reading the live edit signals — not just dirty() —
    // re-arms the trailing debounce on every keystroke (dirty() stays true, so it alone
    // wouldn't re-fire the effect). dirty() then decides whether to actually save.
    // Single-flight: saving() gates a save out while one is in flight; when it clears,
    // a still-dirty Entity re-arms here, coalescing mid-flight edits into one follow-up.
    // Paused on conflict (a stale base version would just loop), during route load, and
    // after a failed save until the payload changes (unsavedFailure) — else _saving
    // flipping false would retry the same failing PUT every 800ms.
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
  }

  /**
   * Caller passes its ActivatedRoute in — a route-scoped service would get the root
   * injector's route. switchMap keeps a stale A response off B's canvas; 404 →
   * the World's library (ADR-0028) via ActiveWorld; other load errors set the
   * reload-error state so the user sees feedback without a silent redirect.
   */
  watchRoute(route: ActivatedRoute): void {
    route.paramMap
      .pipe(
        map((params) => params.get('id')),
        filter((id): id is string => id !== null),
        switchMap((id) =>
          this.openRoute(id).pipe(
            catchError((err) => {
              if (err instanceof HttpErrorResponse && err.status === 404) {
                const worldId = this.activeWorld.worldId();
                this.router.navigate(worldId ? ['/w', worldId, 'entities'] : ['/']);
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

    // Editor surface lives in the URL (#75): refresh/shared link restores the view,
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

  adopt(detail: EntityDetail): void {
    this._conflict.set(null);
    this._error.set(null);
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
  }

  /** Wrap the editor's latest snapshot in the format envelope (ADR-0019). */
  setContent(snapshot: unknown): void {
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
    // None open, or one loading under navigation → no-op (not a throw), so a stale
    // rename can't write to the Entity the user navigated away from (#4).
    const open = this._current();
    if (!open || this._loading()) return EMPTY;
    return this.entities.rename(open.id, name).pipe(
      tap((updated) => {
        this._current.set(updated);
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
        // Harvested from the same Content reference being sent, so the index the server
        // writes matches exactly the links this save persists (#96, ADR-0023).
        descriptors: harvestDescriptors(content.snapshot as JSONContent),
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
    const { grid, content, tags, descriptors } = snapshot;
    const body = withContent(withGrid(open.document, grid), content);
    const save$ = this.entities
      .save(open.id, body, open.version, tags, descriptors)
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
          this._current.set(outcome.entity);
          this._baseGrid.set(grid);
          this._baseContent.set(content);
          this._baseTags.set(tags);
        }
      }),
      catchError(() => {
        this._error.set('save');
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

/** Parse through {@link hexMapSchema} so the schema drops `type`/`content`, not a hand-listed field set; empty for notes. */
function gridOf(body: EntityBody): HexMap {
  return body.type === 'hexmap' ? hexMapSchema.parse(body) : emptyHexMap();
}

/**
 * Re-wrap an edited grid into the body, carrying Content and type through (ADR-0019).
 * Non-hexmap bodies pass through as-is, so the hex seam can't coerce a note on save.
 */
function withGrid(body: EntityBody, grid: HexMap): EntityBody {
  return body.type === 'hexmap' ? { ...body, ...grid } : body;
}

/** Fold the live Content into the body on save (ADR-0019); spread preserves the type discriminant. */
function withContent(body: EntityBody, content: Content): EntityBody {
  return { ...body, content };
}
