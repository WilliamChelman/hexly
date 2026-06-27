import {
  computed,
  DestroyRef,
  Injectable,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  catchError,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
  map,
  Observable,
  switchMap,
  tap,
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
import { EntitiesClient } from '../../../core/services/entities.client';
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

@Injectable()
export class EntitySession {
  private readonly entities = inject(EntitiesClient);
  private readonly editor = inject(HexMapStore);
  private readonly title = inject(TitleService);
  private readonly router = inject(Router);
  private readonly shell = inject(AppShellStore);
  private readonly destroyRef = inject(DestroyRef);

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

  constructor() {
    // One owner for the tab title across every view this route dispatches to.
    effect(() => this.title.setDocumentName(this._current()?.name ?? null));
    this.destroyRef.onDestroy(() => this.title.setDocumentName(null));

    // Best-effort flush on route leave (ADR-0026): the debounce almost always leaves a
    // pending edit when the user navigates. The HttpClient request outlives this
    // destroyed, route-scoped session, so it completes; a conflict/error it can't show
    // is accepted (last-write-wins, and the in-app chip covers staying on the page).
    this.destroyRef.onDestroy(() => {
      if (this.dirty()) this.save().subscribe();
    });

    // Tab close / refresh / external nav tears the page down before any async save can
    // land (ADR-0026): warn the browser so the user can stay and let autosave finish.
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (this.dirty()) event.preventDefault();
    };
    // Cmd/Ctrl+S flushes now instead of waiting out the debounce, and suppresses the
    // browser's "save page" dialog — muscle memory still works without a button.
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 's' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.save().subscribe();
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
    // Paused on conflict (a stale base version would just loop) and during route load.
    effect((onCleanup) => {
      this.editor.document();
      this._content();
      this._tags();
      const armed =
        this.dirty() &&
        !this._conflict() &&
        !this._saving() &&
        !this._loading();
      if (!armed) return;
      const timer = setTimeout(() => this.save().subscribe(), AUTOSAVE_DELAY_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }

  /**
   * Caller passes its ActivatedRoute in — a route-scoped service would get the root
   * injector's route. switchMap keeps a stale A response off B's canvas; 404 → library.
   */
  watchRoute(route: ActivatedRoute): void {
    route.paramMap
      .pipe(
        map((params) => params.get('id')),
        filter((id): id is string => id !== null),
        switchMap((id) =>
          this.openRoute(id).pipe(
            catchError(() => {
              this.router.navigateByUrl('/entities');
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
    this.editor.load(emptyHexMap()); // clear the previous canvas during load (#7)
    this._tags.set([]); // and the previous Entity's tags/content, which ride the same load (#88)
    this._content.set(null);
    this._loading.set(true);
    return this.open(id).pipe(
      this.shell.withLoading('subtle'),
      finalize(() => this._loading.set(false)),
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

  /** Save the editor's live grid under the open Entity's base version. */
  save(): Observable<EntitySaveOutcome> {
    // None open, or one loading under navigation → no-op: avoids sticking `_saving`
    // on "Saving…" or writing to the wrong Entity (#4). Already saving → no-op too, so
    // a Cmd+S or flush can't start a second concurrent write (the scheduler coalesces
    // mid-flight edits into one follow-up once this resolves, ADR-0026).
    const open = this._current();
    if (!open || this._loading() || this._saving()) return EMPTY;
    this._saving.set(true);
    this._error.set(null);
    // Snapshot the exact references being sent. A clean save advances the baseline to
    // *these*, not the live signals, so keystrokes that land mid-flight stay dirty and
    // ride the next save instead of being silently marked clean (ADR-0026).
    const sentGrid = this.editor.document();
    const sentContent = this._content()!;
    const sentTags = this._tags();
    const body = withContent(withGrid(open.document, sentGrid), sentContent);
    return this.entities.save(open.id, body, open.version, sentTags).pipe(
      tap((outcome) => {
        // On conflict, leave the open Entity untouched so the edit survives until
        // a re-pull; only a clean save advances it.
        if (outcome.status === 'conflict') {
          this._conflict.set(outcome.current);
        } else {
          this._conflict.set(null);
          this._current.set(outcome.entity);
          this._baseGrid.set(sentGrid);
          this._baseContent.set(sentContent);
          this._baseTags.set(sentTags);
        }
      }),
      catchError(() => {
        this._error.set('save');
        return EMPTY;
      }),
      this.shell.withLoading('subtle'),
      finalize(() => this._saving.set(false)),
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
