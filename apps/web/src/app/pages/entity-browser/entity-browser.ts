import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntitySummary, EntityType } from '@hexly/domain';
import { EntitiesClient } from '../../core/services/entities.client';
import { WorldStore } from '../../core/services/world.store';
import { ToasterService } from '../../core/services/toaster.service';
import { AppShellStore } from '../../shell/app-shell.store';
import { Autofocus } from '../../ui/autofocus';
import { Button } from '../../ui/button';
import { Eyebrow } from '../../ui/eyebrow';
import { PageHeader } from '../../ui/page-header';
import { Panel } from '../../ui/panel';
import { Icon } from '../../ui/icon/icon';

// ponytail: bounded first page so a large vault loads fast; bump or make
// configurable only if a real page size proves wrong in use.
const PAGE_SIZE = 50;

/**
 * Format an epoch-millis timestamp for `lang` using native `Intl` (ADR-0014 — no
 * DatePipe/registerLocaleData). Falls back to the runtime default if `lang` is
 * somehow not a valid BCP-47 tag, so a misconfigured locale can't throw and take
 * the whole card list's render down with it.
 */
function formatEdited(updatedAt: number, lang: string): string {
  const date = new Date(updatedAt);
  try {
    return date.toLocaleDateString(lang);
  } catch {
    return date.toLocaleDateString();
  }
}

/**
 * The Entity browser: the landing surface (`/entities`) where a user sees every
 * Entity they own — notes and maps together — with each one's name, type, tags,
 * and last-edited date, and runs the lifecycle: create (note or map), open,
 * rename in place, delete (#70, generalizing issue #6's map list). It accumulates
 * the entities as cursor-paginated pages (ADR-0025): a bounded first page on load,
 * a load-more control that appends the next page, and a refresh from page one after
 * every rename/delete so the view stays coherent without reconciling a stale tail.
 * Opening or creating navigates to `/entities/:id`, the one type-dispatching route.
 */
@Component({
  selector: 'app-entity-browser',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Eyebrow, PageHeader, Panel, Icon, TranslocoPipe, Autofocus],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <app-page-header sticky>
      <div pageHeaderTitle class="flex flex-col">
        <span appEyebrow class="text-gold! tracking-[0.28em]">{{
          'entityBrowser.eyebrow' | transloco
        }}</span>
        <h1 class="font-display text-[22px] text-ink-strong m-0 leading-tight">
          {{ 'entityBrowser.heading' | transloco }}
        </h1>
      </div>
      <button
        type="button"
        pageHeaderActions
        appButton
        variant="default"
        data-testid="new-note"
        [disabled]="creating()"
        (click)="create('note')"
      >
        <app-icon name="plus" [size]="16" />
        {{
          (creating() ? 'entityBrowser.creating' : 'entityBrowser.newNote')
            | transloco
        }}
      </button>
      <button
        type="button"
        pageHeaderActions
        appButton
        variant="primary"
        data-testid="new-map"
        [disabled]="creating()"
        (click)="create('hexmap')"
      >
        <app-icon name="plus" [size]="16" />
        {{
          (creating() ? 'entityBrowser.creating' : 'entityBrowser.newMap')
            | transloco
        }}
      </button>
    </app-page-header>

    <main class="max-w-[60rem] mx-auto py-6 px-5">
      @if (cards().length > 0) {
        <ul
          class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4 m-0 p-0 list-none"
        >
          @for (card of cards(); track card.id) {
            <li>
              <section class="flex items-center gap-2 py-3 px-4" appPanel>
                @if (renamingId() === card.id) {
                  <input
                    type="text"
                    appAutofocus
                    class="flex-1 font-display text-md text-ink-strong bg-surface-sunken border border-gold rounded-sm py-1 px-2 outline-none"
                    [value]="card.title"
                    [attr.data-testid]="'rename-input-' + card.id"
                    [attr.aria-label]="'entityBrowser.renameLabel' | transloco"
                    (keydown.enter)="
                      commitRename(card.id, $any($event.target).value)
                    "
                    (keydown.escape)="cancelRename()"
                  />
                } @else {
                  <button
                    type="button"
                    class="flex flex-1 flex-col gap-1 p-0 text-left bg-transparent border-0 cursor-pointer"
                    [attr.data-testid]="'open-' + card.id"
                    (click)="open(card.id)"
                  >
                    <span
                      class="font-display text-md text-ink-strong"
                      data-testid="entity-title"
                      >{{ card.title }}</span
                    >
                    <span
                      class="text-2xs uppercase tracking-wider text-ink-muted"
                      [attr.data-testid]="'type-' + card.id"
                      >{{ 'entityBrowser.type.' + card.type | transloco }}</span
                    >
                    <span class="meta text-2xs text-ink-muted">{{
                      'entityBrowser.edited' | transloco: { date: card.edited }
                    }}</span>
                    @if (card.tags.length > 0) {
                      <span
                        class="flex flex-wrap gap-1 mt-1"
                        [attr.data-testid]="'tags-' + card.id"
                      >
                        @for (tag of card.tags; track tag) {
                          <span
                            class="text-2xs text-ink-muted bg-surface-sunken rounded-sm py-px px-1"
                            >{{ tag }}</span
                          >
                        }
                      </span>
                    }
                  </button>
                  <button
                    type="button"
                    appButton
                    variant="ghost"
                    size="sm"
                    [attr.data-testid]="'rename-' + card.id"
                    (click)="startRename(card.id)"
                  >
                    {{ 'entityBrowser.rename' | transloco }}
                  </button>
                  <button
                    type="button"
                    appButton
                    variant="ghost"
                    size="sm"
                    danger
                    [attr.data-testid]="'delete-' + card.id"
                    (click)="remove(card.id)"
                  >
                    {{ 'common.delete' | transloco }}
                  </button>
                }
              </section>
            </li>
          }
        </ul>
        @if (nextCursor() !== null) {
          <div class="mt-6 flex justify-center">
            <button
              type="button"
              appButton
              variant="default"
              data-testid="load-more"
              [disabled]="loadingMore()"
              (click)="loadMore()"
            >
              {{
                (loadingMore()
                  ? 'entityBrowser.loadingMore'
                  : 'entityBrowser.loadMore'
                ) | transloco
              }}
            </button>
          </div>
        }
      } @else if (loadError()) {
        <section
          class="p-6 text-center text-ink-muted"
          data-testid="load-error"
          appPanel
        >
          <p>{{ 'entityBrowser.loadErrorTitle' | transloco }}</p>
          <p class="text-sm">{{ 'entityBrowser.loadErrorHint' | transloco }}</p>
        </section>
      } @else if (loaded()) {
        <section
          class="p-6 text-center text-ink-muted"
          data-testid="empty"
          appPanel
        >
          <p>{{ 'entityBrowser.emptyTitle' | transloco }}</p>
          <p class="text-sm">{{ 'entityBrowser.emptyHint' | transloco }}</p>
        </section>
      }
    </main>
  `,
})
export class EntityBrowser {
  private readonly entitiesClient = inject(EntitiesClient);
  private readonly worlds = inject(WorldStore);
  private readonly router = inject(Router);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly shell = inject(AppShellStore);

  private readonly _entities = signal<EntitySummary[]>([]);
  /** The user's entities, newest first. */
  protected readonly entities = computed(() =>
    [...this._entities()].sort((a, b) => b.updatedAt - a.updatedAt),
  );
  /** The entities as view rows, with the last-edited date pre-formatted for the
   * active language (ADR-0014). Keyed on `entities` and the active lang, so each
   * date formats once per list/language change and reflows live on a switch — not
   * on every change-detection pass, as a template method call would. */
  protected readonly cards = computed(() => {
    const lang = this.transloco.activeLang();
    return this.entities().map((entity) => ({
      id: entity.id,
      title: entity.name,
      type: entity.type,
      tags: entity.tags,
      edited: formatEdited(entity.updatedAt, lang),
    }));
  });
  /** The cursor for the next page, or `null` on the last page — gates load-more (ADR-0025). */
  protected readonly nextCursor = signal<string | null>(null);
  /** Whether a load-more is in flight — disables the control so a double-click can't double-append. */
  protected readonly loadingMore = signal(false);
  /** Whether the initial load has resolved — gates the empty state. */
  protected readonly loaded = signal(false);
  /** Whether the initial load failed — shows an error panel instead. */
  protected readonly loadError = signal(false);
  /** Whether a create is in flight — disables the create buttons. */
  protected readonly creating = signal(false);
  /** The id of the Entity whose name is being edited inline, or `null`. */
  protected readonly renamingId = signal<string | null>(null);

  private fetchSub?: Subscription;

  constructor() {
    // Re-fetch page one whenever the active World changes (ADR-0024). When there
    // is no active World but the store has finished loading (user has 0 Worlds),
    // surface the empty state instead of leaving the page blank.
    effect(() => {
      const worldId = this.worlds.activeWorldId();
      if (worldId) {
        this.fetchFirstPage();
      } else if (this.worlds.loaded()) {
        this.fetchFirstPage(); // short-circuits inside to set empty state
      }
    });
  }

  /**
   * Fetch page one and replace the accumulated list with it (ADR-0025). Used on
   * load and after every create/rename/delete: refreshing from page one keeps the
   * view coherent without reconciling a stale accumulated tail, and page one is the
   * only view a client can always re-request — it needs no cursor and is bounded by
   * `limit`, so it survives any future opaque-cursor encoding change.
   */
  private fetchFirstPage(): void {
    const worldId = this.worlds.activeWorldId();
    // No active World (user has 0 Worlds): surface the empty state directly.
    if (!worldId) {
      this.fetchSub?.unsubscribe();
      this._entities.set([]);
      this.nextCursor.set(null);
      this.loadingMore.set(false);
      this.loadError.set(false);
      this.loaded.set(true);
      return;
    }
    // Cancel any in-flight request from a previous World (prevents stale data race).
    this.fetchSub?.unsubscribe();
    // Reset state so the template shows loading rather than stale data from the old World.
    this._entities.set([]);
    this.nextCursor.set(null);
    this.loadingMore.set(false); // clear any stuck load-more from the previous World
    this.loadError.set(false);
    this.loaded.set(false);
    this.fetchSub = this.entitiesClient
      .list({ limit: PAGE_SIZE, worldId })
      .pipe(this.shell.withLoading('subtle'))
      .subscribe({
        next: (page) => {
          this._entities.set(page.items);
          this.nextCursor.set(page.nextCursor);
          this.loaded.set(true);
        },
        error: () => {
          this.loaded.set(true);
          this.loadError.set(true);
        },
      });
  }

  /**
   * Fetch the next page via the opaque `nextCursor` and append it (ADR-0025). The
   * `loadingMore` guard makes a double-click a no-op so a page can't be appended
   * twice. A failed fetch just re-enables the control to retry — the list it already
   * shows stays intact.
   */
  protected loadMore(): void {
    const cursor = this.nextCursor();
    if (cursor === null || this.loadingMore()) return;
    this.loadingMore.set(true);
    this.entitiesClient
      .list({ cursor, worldId: this.worlds.activeWorldId() ?? undefined })
      .pipe(finalize(() => this.loadingMore.set(false)))
      .subscribe({
        next: (page) => {
          this._entities.update((entities) => [...entities, ...page.items]);
          this.nextCursor.set(page.nextCursor);
        },
        error: () =>
          this.toaster.show(
            this.transloco.translate('entityBrowser.loadMoreError'),
            'error',
          ),
      });
  }

  /** Create an empty Entity of `type` and open it straight away. */
  protected create(type: EntityType): void {
    if (this.creating()) return;
    this.creating.set(true);
    this.entitiesClient
      .create(
        this.transloco.translate(type === 'note' ? 'domain.untitledNote' : 'domain.untitledMap'),
        type,
        this.worlds.activeWorldId() ?? undefined,
      )
      .pipe(finalize(() => this.creating.set(false)))
      .subscribe({
        // EntitySession loads on open; no pre-adopt from here (it would outlive this page).
        next: (entity) => this.open(entity.id),
        error: () =>
          this.toaster.show(
            this.transloco.translate('entityBrowser.createError'),
            'error',
          ),
      });
  }

  protected open(id: string): void {
    this.router.navigate(['/entities', id]);
  }

  protected startRename(id: string): void {
    this.renamingId.set(id);
  }

  protected cancelRename(): void {
    this.renamingId.set(null);
  }

  /**
   * Rename by name only (ADR-0018). A blank, unchanged, or concurrently-deleted card
   * closes the input without a round trip. On error, closes and toasts.
   */
  protected commitRename(id: string, name: string): void {
    const trimmed = name.trim();
    const current = this._entities().find((entity) => entity.id === id);
    if (!trimmed || !current || trimmed === current.name) {
      this.cancelRename();
      return;
    }
    this.entitiesClient.rename(id, trimmed).subscribe({
      // Refresh from page one (ADR-0025) rather than reconcile in place: a rename
      // can move the item under the server's sort, so re-fetching keeps the view honest.
      next: () => {
        this.renamingId.set(null);
        this.fetchFirstPage();
      },
      error: () => {
        this.cancelRename();
        this.toaster.show(
          this.transloco.translate('entityBrowser.renameError'),
          'error',
        );
      },
    });
  }

  /** Delete an entity, then refresh from page one once the server confirms (ADR-0025). */
  protected remove(id: string): void {
    this.entitiesClient.delete(id).subscribe({
      next: () => this.fetchFirstPage(),
      error: () =>
        this.toaster.show(
          this.transloco.translate('entityBrowser.deleteError'),
          'error',
        ),
    });
  }
}
