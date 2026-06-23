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
import { MapSummary } from '@hexly/domain';
import { MapsStore } from '../maps/maps.store';
import { HeaderService } from '../shell/header.service';
import { Button } from '../ui/button';
import { Panel } from '../ui/panel';
import { PlusIcon } from '../ui/icon/glyphs/plus';

/** The title every freshly created map is given (the user renames later). */
const NEW_MAP_TITLE = 'Untitled map';

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
 * The map library: the landing surface where a user sees every Hex Map they own,
 * opens one into the editor, creates a new one, or deletes one (issue #6 — the
 * "map list / open / create flow"). It holds the list as local state and keeps
 * it in sync with create/delete rather than re-fetching, so the view stays
 * responsive. Opening or creating navigates to `/maps/:id`, the editor route.
 */
@Component({
  selector: 'app-map-library',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Panel, PlusIcon, TranslocoPipe],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <div class="max-w-[60rem] mx-auto py-6 px-5">
      <h1 class="sr-only">{{ pageTitle() }}</h1>
      <div class="flex justify-end mb-5">
        <button
          type="button"
          appButton
          variant="primary"
          data-testid="new-map"
          [disabled]="creating()"
          (click)="newMap()"
        >
          <app-icon-plus [size]="16" />
          {{ (creating() ? 'mapLibrary.creating' : 'mapLibrary.newMap') | transloco }}
        </button>
      </div>

      @if (cards().length > 0) {
        <ul class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4 m-0 p-0 list-none">
          @for (card of cards(); track card.id) {
            <li>
              <section class="flex items-center gap-2 py-3 px-4" appPanel>
                <button
                  type="button"
                  class="flex flex-1 flex-col gap-1 p-0 text-left bg-transparent border-0 cursor-pointer"
                  [attr.data-testid]="'open-' + card.id"
                  (click)="open(card.id)"
                >
                  <span class="font-display text-md text-ink-strong" data-testid="map-title">{{ card.title }}</span>
                  <span class="meta text-2xs text-ink-muted">{{
                    'mapLibrary.edited' | transloco: { date: card.edited }
                  }}</span>
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
              </section>
            </li>
          }
        </ul>
      } @else if (loadError()) {
        <section class="empty p-6 text-center text-ink-muted" data-testid="load-error" appPanel>
          <p>{{ 'mapLibrary.loadErrorTitle' | transloco }}</p>
          <p class="hint">{{ 'mapLibrary.loadErrorHint' | transloco }}</p>
        </section>
      } @else if (loaded()) {
        <section class="empty p-6 text-center text-ink-muted" data-testid="empty" appPanel>
          <p>{{ 'mapLibrary.emptyTitle' | transloco }}</p>
          <p class="hint">{{ 'mapLibrary.emptyHint' | transloco }}</p>
        </section>
      }
    </div>
  `,
  styles: `
    /* The card grid and the open-button box live in inline utilities on their
       elements; only the descendant hint keeps a scoped rule. */
    .empty .hint {
      font-size: var(--text-sm);
    }
  `,
})
export class MapLibrary implements OnInit {
  private readonly maps$ = inject(MapsStore);
  private readonly router = inject(Router);
  private readonly header = inject(HeaderService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly transloco = inject(TranslocoService);

  /** The translated page heading, shown both as the document's <h1> (sr-only)
   * and the header chrome title — sourced from one key so the two can't drift
   * and both re-render live when the language changes. */
  protected readonly pageTitle = translateSignal('mapLibrary.heading');
  private readonly pageEyebrow = translateSignal('mapLibrary.eyebrow');

  private readonly _maps = signal<MapSummary[]>([]);
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
      title: map.title,
      edited: formatEdited(map.updatedAt, lang),
    }));
  });
  /** Whether the initial list has resolved — gates the empty state. */
  protected readonly loaded = signal(false);
  /** Whether the initial list failed — shows an error state, not a blank page. */
  protected readonly loadError = signal(false);
  /** Whether a create is in flight — disables the New map button. */
  protected readonly creating = signal(false);

  constructor() {
    // Contribute this page's heading to the single app header (ADR-0015) as a
    // computed, so the chrome tracks a live language switch — HeaderService owns
    // the subscription. It is withdrawn automatically when this page is
    // destroyed. Set in the constructor (not ngOnInit) so a same-route brand-link
    // round-trip (/maps → / → /maps) that reuses the component keeps the heading
    // intact.
    this.header.set(
      computed(() => ({ eyebrow: this.pageEyebrow(), title: this.pageTitle() })),
      this.destroyRef,
    );
  }

  ngOnInit(): void {
    // Mark the load resolved on either branch: a failed GET /maps must still
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

  /** Create an empty map and open it straight in the editor. */
  protected newMap(): void {
    if (this.creating()) return;
    this.creating.set(true);
    this.maps$
      .create(NEW_MAP_TITLE)
      .pipe(finalize(() => this.creating.set(false)))
      .subscribe((map) => this.open(map.id));
  }

  /** Open a map in the editor. */
  protected open(id: string): void {
    this.router.navigate(['/maps', id]);
  }

  /** Delete a map and drop it from the list once the server confirms. */
  protected remove(id: string): void {
    this.maps$
      .delete(id)
      .subscribe(() => this._maps.update((maps) => maps.filter((m) => m.id !== id)));
  }
}
