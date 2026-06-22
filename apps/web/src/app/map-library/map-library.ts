import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { MapSummary } from '@hexly/domain';
import { MapsStore } from '../maps/maps.store';
import { HeaderService } from '../shell/header.service';
import { Button } from '../ui/button';
import { Panel } from '../ui/panel';
import { PlusIcon } from '../ui/icon/glyphs/plus';

/** The title every freshly created map is given (the user renames later). */
const NEW_MAP_TITLE = 'Untitled map';

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
  imports: [Button, Panel, PlusIcon],
  template: `
    <main>
      <div class="head">
        <button
          type="button"
          appButton
          variant="primary"
          data-testid="new-map"
          [disabled]="creating()"
          (click)="newMap()"
        >
          <app-icon-plus [size]="16" />
          {{ creating() ? 'Creating…' : 'New map' }}
        </button>
      </div>

      @if (maps().length > 0) {
        <ul class="grid">
          @for (map of maps(); track map.id) {
            <li>
              <section class="card" appPanel>
                <button
                  type="button"
                  class="open"
                  [attr.data-testid]="'open-' + map.id"
                  (click)="open(map.id)"
                >
                  <span class="map-title" data-testid="map-title">{{ map.title }}</span>
                  <span class="meta">Edited {{ editedOn(map) }}</span>
                </button>
                <button
                  type="button"
                  appButton
                  variant="ghost"
                  size="sm"
                  danger
                  [attr.data-testid]="'delete-' + map.id"
                  (click)="remove(map.id)"
                >
                  Delete
                </button>
              </section>
            </li>
          }
        </ul>
      } @else if (loadError()) {
        <section class="empty" data-testid="load-error" appPanel>
          <p>Couldn't load your maps.</p>
          <p class="hint">Something went wrong. Please try again in a moment.</p>
        </section>
      } @else if (loaded()) {
        <section class="empty" data-testid="empty" appPanel>
          <p>No maps yet.</p>
          <p class="hint">Create your first map to start painting a world.</p>
        </section>
      }
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
      background: var(--surface-sunken);
    }
    main {
      max-width: 60rem;
      margin: 0 auto;
      padding: var(--space-6) var(--space-5);
    }
    .head {
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      gap: var(--space-4);
      margin-bottom: var(--space-5);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
      gap: var(--space-4);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .card {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-3) var(--space-4);
    }
    .open {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--space-1);
      padding: 0;
      text-align: left;
      background: none;
      border: none;
      cursor: pointer;
    }
    .map-title {
      font-family: var(--font-display);
      font-size: var(--text-md);
      color: var(--ink-strong);
    }
    .meta {
      font-size: var(--text-2xs);
      color: var(--ink-muted);
    }
    .empty {
      padding: var(--space-6);
      text-align: center;
      color: var(--ink-muted);
    }
    .empty .hint {
      font-size: var(--text-sm);
    }
  `,
})
export class MapLibrary implements OnInit, OnDestroy {
  private readonly maps$ = inject(MapsStore);
  private readonly router = inject(Router);
  private readonly header = inject(HeaderService);

  private readonly _maps = signal<MapSummary[]>([]);
  /** The user's maps, newest first. */
  protected readonly maps = computed(() =>
    [...this._maps()].sort((a, b) => b.updatedAt - a.updatedAt),
  );
  /** Whether the initial list has resolved — gates the empty state. */
  protected readonly loaded = signal(false);
  /** Whether the initial list failed — shows an error state, not a blank page. */
  protected readonly loadError = signal(false);
  /** Whether a create is in flight — disables the New map button. */
  protected readonly creating = signal(false);

  ngOnInit(): void {
    // Contribute this page's heading to the single app header (ADR-0015).
    this.header.set({ eyebrow: 'Library', title: 'Your maps' });

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

  ngOnDestroy(): void {
    // Withdraw our heading as we leave, so a page that contributes none (the
    // editor projects its own through the named outlet) doesn't inherit it.
    // Reused across same-route navigation, the component isn't destroyed, so a
    // brand-link round-trip back to /maps keeps the heading intact.
    this.header.clear();
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

  /** Format a map's last-edited time for display. */
  protected editedOn(map: MapSummary): string {
    return new Date(map.updatedAt).toLocaleDateString();
  }
}
