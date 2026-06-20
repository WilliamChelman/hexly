import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { MapSummary } from '@hexly/domain';
import { AuthStore } from '../auth/auth.store';
import { MapsStore } from '../maps/maps.store';
import { ThemeService } from '../core/theme.service';
import { Button } from '../ui/button';
import { Cartouche } from '../ui/cartouche';
import { Eyebrow } from '../ui/eyebrow';
import { Panel } from '../ui/panel';
import { LogoIcon } from '../ui/icon/glyphs/logo';
import { MoonIcon } from '../ui/icon/glyphs/moon';
import { PlusIcon } from '../ui/icon/glyphs/plus';
import { SunIcon } from '../ui/icon/glyphs/sun';

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
  imports: [
    Button,
    Cartouche,
    Eyebrow,
    Panel,
    LogoIcon,
    MoonIcon,
    PlusIcon,
    SunIcon,
  ],
  template: `
    <header class="topbar">
      <div class="brand">
        <span class="mark"><app-icon-logo [size]="26" /></span>
        <span appCartouche>Hexly</span>
      </div>
      <div class="account">
        <button
          type="button"
          appButton
          variant="ghost"
          icon
          (click)="themeService.toggle()"
          [attr.aria-label]="
            theme() === 'dark' ? 'Switch to parchment theme' : 'Switch to astral theme'
          "
        >
          @if (theme() === 'dark') {
            <app-icon-sun [size]="20" />
          } @else {
            <app-icon-moon [size]="20" />
          }
        </button>
        @if (user(); as u) {
          <span class="who">{{ u.displayName }}</span>
        }
        <button
          type="button"
          appButton
          variant="ghost"
          size="sm"
          data-testid="sign-out"
          (click)="signOut()"
        >
          Sign out
        </button>
      </div>
    </header>

    <main>
      <div class="head">
        <div>
          <span appEyebrow>Library</span>
          <h1>Your maps</h1>
        </div>
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
      min-height: 100vh;
      background: var(--surface-sunken);
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: var(--space-5);
      padding: 0 var(--space-5);
      height: var(--rail-header);
      background: var(--surface);
      border-bottom: 1px solid var(--line-strong);
      box-shadow: var(--shadow-1);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .mark {
      display: grid;
      place-items: center;
      color: var(--gold);
    }
    .account {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin-left: auto;
    }
    .who {
      font-size: var(--text-sm);
      color: var(--ink);
    }
    main {
      max-width: 60rem;
      margin: 0 auto;
      padding: var(--space-6) var(--space-5);
    }
    .head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--space-4);
      margin-bottom: var(--space-5);
    }
    h1 {
      margin: var(--space-1) 0 0;
      font-family: var(--font-display);
      font-size: var(--text-xl);
      color: var(--ink-strong);
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
export class MapLibrary implements OnInit {
  private readonly maps$ = inject(MapsStore);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  protected readonly themeService = inject(ThemeService);
  protected readonly theme = this.themeService.theme;

  /** The signed-in user, shown in the top bar. */
  protected readonly user = this.auth.currentUser;

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

  /** Format a map's last-edited time for display. */
  protected editedOn(map: MapSummary): string {
    return new Date(map.updatedAt).toLocaleDateString();
  }

  /** End the session and return to the sign-in screen. */
  protected signOut(): void {
    this.auth.signOut();
  }
}
