import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntitySummary, EntityType } from '@hexly/domain';
import { EntitiesClient } from '../../core/services/entities.client';
import { ActiveWorld } from '../../core/services/active-world';
import { ToasterService } from '../../core/services/toaster.service';
import { AppShellStore } from '../../shell/app-shell.store';
import { Autofocus } from '../../ui/autofocus';
import { Button } from '../../ui/button';
import { Eyebrow } from '../../ui/eyebrow';
import { PageHeader } from '../../ui/page-header';
import { Panel } from '../../ui/panel';
import { Icon, IconName } from '../../ui/icon/icon';
import { ACCENT_BAR, ACCENT_SIGIL, accentFor } from '../../ui/sigil';

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
 * The Entity browser: the in-World surface (`/w/:worldId/entities`) where a user
 * sees every Entity in that World — notes and maps together — with name, type, tags,
 * and last-edited date, and runs the lifecycle: create (note or map), open,
 * rename in place, delete (#70, generalizing issue #6's map list). It accumulates
 * the entities as cursor-paginated pages (ADR-0025): a bounded first page on load,
 * a load-more control that appends the next page, and a refresh from page one after
 * every rename/delete so the view stays coherent without reconciling a stale tail.
 * Opening or creating navigates to `/w/:worldId/entities/:id`, the one type-dispatching route.
 */
@Component({
  selector: 'app-entity-browser',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
    Eyebrow,
    PageHeader,
    Panel,
    Icon,
    TranslocoPipe,
    Autofocus,
    RouterLink,
  ],
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

    <main class="max-w-[60rem] mx-auto py-8 px-6">
      @if (cards().length > 0) {
        <ul
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 m-0 p-0 list-none"
        >
          @for (card of cards(); track card.id) {
            <li>
              <section
                class="group relative flex gap-4 p-4 pl-6 overflow-hidden h-full transition-shadow hover:shadow-3 has-[a:focus-visible]:[outline:2px_solid_var(--color-gold)] has-[a:focus-visible]:outline-offset-2"
                appPanel
                raised
              >
                <span
                  class="absolute left-0 top-0 bottom-0 w-1.5 {{ bar(card.id) }}"
                ></span>
                <span
                  class="shrink-0 size-12 rounded-full flex items-center justify-center {{
                    sigil(card.id)
                  }}"
                >
                  <app-icon [name]="typeIcon(card.type)" [size]="20" />
                </span>
                <div class="min-w-0 flex-1">
                  @if (renamingId() === card.id) {
                    <input
                      type="text"
                      appAutofocus
                      class="w-full font-display text-md text-ink-strong bg-surface-sunken border border-gold rounded-sm py-1 px-2 outline-none"
                      [value]="card.title"
                      [attr.data-testid]="'rename-input-' + card.id"
                      [attr.aria-label]="'entityBrowser.renameLabel' | transloco"
                      (keydown.enter)="
                        commitRename(card.id, $any($event.target).value)
                      "
                      (keydown.escape)="cancelRename()"
                    />
                  } @else {
                    <!-- Stretched link (inset ::after) makes the whole tile open
                         the Entity; the action buttons sit OUTSIDE this anchor,
                         lifted above the overlay with z-10 so they stay clickable
                         and the markup keeps no nested interactives (a11y). -->
                    <a
                      class="block w-full no-underline outline-none focus-visible:shadow-none after:content-[''] after:absolute after:inset-0"
                      [routerLink]="['/w', worldId(), 'entities', card.id]"
                      [attr.data-testid]="'open-' + card.id"
                      [attr.aria-label]="card.title"
                    >
                      <span
                        class="font-display text-lg text-ink-strong leading-tight line-clamp-2 group-hover:text-gold transition-colors"
                        data-testid="entity-title"
                        >{{ card.title }}</span
                      >
                    </a>
                    <hr class="border-0 border-t border-line my-2" />
                    <div class="flex items-center gap-2">
                      <span
                        class="text-2xs uppercase tracking-wider text-ink-muted"
                        [attr.data-testid]="'type-' + card.id"
                        >{{
                          'entityBrowser.type.' + card.type | transloco
                        }}</span
                      >
                      <span class="text-2xs text-ink-faint">·</span>
                      <span class="meta text-2xs text-ink-muted">{{
                        'entityBrowser.edited' | transloco: { date: card.edited }
                      }}</span>
                      <span
                        class="relative z-10 ml-auto flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                      >
                        <button
                          type="button"
                          appButton
                          icon
                          variant="ghost"
                          size="sm"
                          [attr.data-testid]="'rename-' + card.id"
                          [attr.aria-label]="'entityBrowser.rename' | transloco"
                          [attr.title]="'entityBrowser.rename' | transloco"
                          (click)="startRename(card.id)"
                        >
                          <app-icon name="label" [size]="16" />
                        </button>
                        <button
                          type="button"
                          appButton
                          icon
                          variant="ghost"
                          size="sm"
                          danger
                          [attr.data-testid]="'delete-' + card.id"
                          [attr.aria-label]="'common.delete' | transloco"
                          [attr.title]="'common.delete' | transloco"
                          (click)="remove(card.id)"
                        >
                          <app-icon name="erase" [size]="16" />
                        </button>
                      </span>
                    </div>
                    @if (card.tags.length > 0) {
                      <span
                        class="flex flex-wrap gap-1 mt-2"
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
                  }
                </div>
              </section>
            </li>
          }
        </ul>
        @if (nextCursor() !== null) {
          <div class="mt-8 flex justify-center">
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
          class="p-8 text-center text-ink-muted"
          data-testid="load-error"
          appPanel
        >
          <p>{{ 'entityBrowser.loadErrorTitle' | transloco }}</p>
          <p class="text-sm">{{ 'entityBrowser.loadErrorHint' | transloco }}</p>
        </section>
      } @else if (loaded()) {
        <section
          class="p-8 text-center text-ink-muted"
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
  private readonly activeWorld = inject(ActiveWorld);
  private readonly router = inject(Router);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly shell = inject(AppShellStore);

  /** The active World id (always present under `/w/:worldId`) — the routerLink scope for each tile. */
  protected readonly worldId = this.activeWorld.worldId;

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
    // Re-fetch page one whenever the World in the URL changes (ADR-0028). The
    // browser only mounts under /w/:worldId, so a worldId is always present;
    // reacting to it covers a param-only switch between Worlds (same component).
    effect(() => {
      if (this.activeWorld.worldId()) this.fetchFirstPage();
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
    const worldId = this.activeWorld.worldId();
    // Defensive: the browser only mounts under /w/:worldId, but never fetch the
    // whole owner list (every World) if the segment is somehow absent.
    if (!worldId) return;
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
      .list({ cursor, worldId: this.activeWorld.worldId() ?? undefined })
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
        this.activeWorld.worldId() ?? undefined,
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
    this.router.navigate(['/w', this.activeWorld.worldId(), 'entities', id]);
  }

  /** The sigil glyph for an Entity's type — a hex map reads as terrain, a note as a label. */
  protected typeIcon(type: EntityType): IconName {
    return type === 'hexmap' ? 'terrain' : 'label';
  }

  protected sigil(id: string): string {
    return ACCENT_SIGIL[accentFor(id)];
  }
  protected bar(id: string): string {
    return ACCENT_BAR[accentFor(id)];
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
