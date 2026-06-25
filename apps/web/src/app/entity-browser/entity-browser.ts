import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import {
  translateSignal,
  TranslocoPipe,
  TranslocoService,
} from '@jsverse/transloco';
import { EntitySummary, EntityType } from '@hexly/domain';
import { EntitiesClient } from '../entities/entities.client';
import { ToasterService } from '../core/toaster.service';
import { HeaderService } from '../shell/header.service';
import { Autofocus } from '../ui/autofocus';
import { Button } from '../ui/button';
import { Panel } from '../ui/panel';
import { Icon } from '../ui/icon/icon';

/** The title every freshly created Entity is given (the user renames later). */
const NEW_MAP_TITLE = 'Untitled map';
const NEW_NOTE_TITLE = 'Untitled note';

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
 * rename in place, delete (#70, generalizing issue #6's map list). It holds the
 * list as local state and keeps it in sync with create/rename/delete rather than
 * re-fetching, so the view stays responsive. Opening or creating navigates to
 * `/entities/:id`, the one type-dispatching route.
 */
@Component({
  selector: 'app-entity-browser',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Panel, Icon, TranslocoPipe, Autofocus],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <div class="max-w-[60rem] mx-auto py-6 px-5">
      <h1 class="sr-only">{{ pageTitle() }}</h1>
      <div class="flex justify-end gap-2 mb-5">
        <button
          type="button"
          appButton
          variant="default"
          data-testid="new-note"
          [disabled]="creating()"
          (click)="create('note')"
        >
          <app-icon name="plus" [size]="16" />
          {{ (creating() ? 'entityBrowser.creating' : 'entityBrowser.newNote') | transloco }}
        </button>
        <button
          type="button"
          appButton
          variant="primary"
          data-testid="new-map"
          [disabled]="creating()"
          (click)="create('hexmap')"
        >
          <app-icon name="plus" [size]="16" />
          {{ (creating() ? 'entityBrowser.creating' : 'entityBrowser.newMap') | transloco }}
        </button>
      </div>

      @if (cards().length > 0) {
        <ul class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4 m-0 p-0 list-none">
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
                    (keydown.enter)="commitRename(card.id, $any($event.target).value)"
                    (keydown.escape)="cancelRename()"
                  />
                } @else {
                <button
                  type="button"
                  class="flex flex-1 flex-col gap-1 p-0 text-left bg-transparent border-0 cursor-pointer"
                  [attr.data-testid]="'open-' + card.id"
                  (click)="open(card.id)"
                >
                  <span class="font-display text-md text-ink-strong" data-testid="map-title">{{ card.title }}</span>
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
                        <span class="text-2xs text-ink-muted bg-surface-sunken rounded-sm py-px px-1">{{ tag }}</span>
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
      } @else if (loadError()) {
        <section class="p-6 text-center text-ink-muted" data-testid="load-error" appPanel>
          <p>{{ 'entityBrowser.loadErrorTitle' | transloco }}</p>
          <p class="text-sm">{{ 'entityBrowser.loadErrorHint' | transloco }}</p>
        </section>
      } @else if (loaded()) {
        <section class="p-6 text-center text-ink-muted" data-testid="empty" appPanel>
          <p>{{ 'entityBrowser.emptyTitle' | transloco }}</p>
          <p class="text-sm">{{ 'entityBrowser.emptyHint' | transloco }}</p>
        </section>
      }
    </div>
  `,
})
export class EntityBrowser implements OnInit {
  private readonly maps$ = inject(EntitiesClient);
  private readonly router = inject(Router);
  private readonly header = inject(HeaderService);
  private readonly toaster = inject(ToasterService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly transloco = inject(TranslocoService);

  /** The translated page heading, shown both as the document's <h1> (sr-only)
   * and the header chrome title — sourced from one key so the two can't drift
   * and both re-render live when the language changes. */
  protected readonly pageTitle = translateSignal('entityBrowser.heading');
  private readonly pageEyebrow = translateSignal('entityBrowser.eyebrow');

  private readonly _maps = signal<EntitySummary[]>([]);
  /** The user's maps, newest first. */
  protected readonly maps = computed(() =>
    [...this._maps()].sort((a, b) => b.updatedAt - a.updatedAt),
  );
  /** The maps as view rows, with the last-edited date pre-formatted for the
   * active language (ADR-0014). Keyed on `maps` and the active lang, so each date
   * formats once per list/language change and reflows live on a switch — not on
   * every change-detection pass, as a template method call would. */
  protected readonly cards = computed(() => {
    const lang = this.transloco.activeLang();
    return this.maps().map((map) => ({
      id: map.id,
      title: map.name,
      type: map.type,
      tags: map.tags,
      edited: formatEdited(map.updatedAt, lang),
    }));
  });
  /** Whether the initial list has resolved — gates the empty state. */
  protected readonly loaded = signal(false);
  /** Whether the initial list failed — shows an error state, not a blank page. */
  protected readonly loadError = signal(false);
  /** Whether a create is in flight — disables the New map button. */
  protected readonly creating = signal(false);
  /** The id of the Entity whose name is being edited inline, or `null`. */
  protected readonly renamingId = signal<string | null>(null);

  constructor() {
    // Contribute this page's heading to the single app header (ADR-0015) as a
    // computed, so the chrome tracks a live language switch — HeaderService owns
    // the subscription. It is withdrawn automatically when this page is
    // destroyed. Set in the constructor (not ngOnInit) so a same-route brand-link
    // round-trip (/entities → / → /entities) that reuses the component keeps the heading
    // intact.
    this.header.set(
      computed(() => ({ eyebrow: this.pageEyebrow(), title: this.pageTitle() })),
      this.destroyRef,
    );
  }

  ngOnInit(): void {
    // Mark the load resolved on either branch: a failed GET /entities must still
    // surface something (an error panel) rather than leaving the page blank
    // forever because `loaded` never flipped.
    this.maps$.list().subscribe({
      next: (maps) => {
        this._maps.set(maps);
        this.loaded.set(true);
      },
      error: () => {
        this.loaded.set(true);
        this.loadError.set(true);
      },
    });
  }

  /** Create an empty Entity of `type` and open it straight away. */
  protected create(type: EntityType): void {
    if (this.creating()) return;
    this.creating.set(true);
    this.maps$
      .create(type === 'note' ? NEW_NOTE_TITLE : NEW_MAP_TITLE, type)
      .pipe(finalize(() => this.creating.set(false)))
      .subscribe({
        // The route-scoped EditorSession loads the Entity on open; no pre-adopt
        // from here (it would outlive the create's own page).
        next: (entity) => this.open(entity.id),
        error: () =>
          this.toaster.show(
            this.transloco.translate('entityBrowser.createError'),
            'error',
          ),
      });
  }

  // Open any Entity through the one type-dispatching route (#70): the shell at
  // `/entities/:id` loads it and renders the map editor or the note view.
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
   * Rename an Entity by name only (metadata, ADR-0018 — version untouched, no
   * body). A blank or unchanged name — or one whose card is no longer listed
   * (concurrently deleted) — just closes the editor without a round trip. On
   * success the list row is refreshed from the server's Entity; on failure the
   * input is closed and the error is surfaced rather than left stuck open.
   */
  protected commitRename(id: string, name: string): void {
    const trimmed = name.trim();
    const current = this._maps().find((m) => m.id === id);
    if (!trimmed || !current || trimmed === current.name) {
      this.cancelRename();
      return;
    }
    this.maps$.rename(id, trimmed).subscribe({
      // EntityDetail is assignable to the summary list; the extra body it carries
      // is harmless.
      next: (updated) => {
        this._maps.update((maps) => maps.map((m) => (m.id === id ? updated : m)));
        this.renamingId.set(null);
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

  /** Delete a map and drop it from the list once the server confirms. */
  protected remove(id: string): void {
    this.maps$.delete(id).subscribe({
      next: () =>
        this._maps.update((maps) => maps.filter((m) => m.id !== id)),
      error: () =>
        this.toaster.show(
          this.transloco.translate('entityBrowser.deleteError'),
          'error',
        ),
    });
  }
}
