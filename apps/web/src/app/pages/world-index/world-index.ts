import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AuthClient } from '../../core/services/auth.client';
import { WorldStore } from '../../core/services/world.store';
import { ToasterService } from '../../core/services/toaster.service';
import { Button } from '../../ui/button';
import { Eyebrow } from '../../ui/eyebrow';
import { PageHeader } from '../../ui/page-header';
import { Panel } from '../../ui/panel';
import { Icon } from '../../ui/icon/icon';

/**
 * The World Index (ADR-0028, CONTEXT.md → World Index): the page at `/` listing
 * every World the caller can reach — owned and member — and the surface that owns
 * World create. It is the chooser, not an auto-redirect: a user with zero Worlds
 * sees an empty state with a Create affordance rather than an edge case to redirect
 * around. Owned-vs-member is derived by comparing each World's `ownerId` to the
 * current user. Creating opens the new World's Home Entity; activating an existing
 * World enters its Entity browser.
 */
@Component({
  selector: 'app-world-index',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Eyebrow, PageHeader, Panel, Icon, TranslocoPipe],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <app-page-header sticky>
      <div pageHeaderTitle class="flex flex-col">
        <span appEyebrow class="text-gold! tracking-[0.28em]">{{
          'worldIndex.eyebrow' | transloco
        }}</span>
        <h1 class="font-display text-[22px] text-ink-strong m-0 leading-tight">
          {{ 'worldIndex.heading' | transloco }}
        </h1>
      </div>
      <button
        type="button"
        pageHeaderActions
        appButton
        variant="primary"
        data-testid="create-world"
        [disabled]="creating()"
        (click)="create()"
      >
        <app-icon name="plus" [size]="16" />
        {{ (creating() ? 'worldIndex.creating' : 'worlds.new') | transloco }}
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
                <button
                  type="button"
                  class="flex flex-1 flex-col gap-1 p-0 text-left bg-transparent border-0 cursor-pointer"
                  [attr.data-testid]="'world-' + card.id"
                  (click)="enter(card.id)"
                >
                  <span class="font-display text-md text-ink-strong">{{
                    card.name
                  }}</span>
                </button>
                @if (card.owned) {
                  <span
                    class="text-2xs uppercase tracking-wider text-gold"
                    [attr.data-testid]="'owned-' + card.id"
                    >{{ 'worldIndex.owned' | transloco }}</span
                  >
                } @else {
                  <span
                    class="text-2xs uppercase tracking-wider text-ink-muted"
                    [attr.data-testid]="'member-' + card.id"
                    >{{ 'worldIndex.member' | transloco }}</span
                  >
                }
              </section>
            </li>
          }
        </ul>
      } @else if (loadError()) {
        <section
          class="p-6 text-center text-ink-muted"
          data-testid="load-error"
          appPanel
        >
          <p>{{ 'worldIndex.loadErrorTitle' | transloco }}</p>
          <p class="text-sm">{{ 'worldIndex.loadErrorHint' | transloco }}</p>
        </section>
      } @else if (loaded()) {
        <section
          class="p-6 text-center text-ink-muted"
          data-testid="worlds-empty"
          appPanel
        >
          <p>{{ 'worldIndex.emptyTitle' | transloco }}</p>
          <p class="text-sm">{{ 'worldIndex.emptyHint' | transloco }}</p>
        </section>
      }
    </main>
  `,
})
export class WorldIndex {
  private readonly store = inject(WorldStore);
  private readonly auth = inject(AuthClient);
  private readonly router = inject(Router);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  protected readonly loaded = this.store.loaded;
  protected readonly loadError = this.store.loadError;
  /** The reachable Worlds, each tagged owned (caller is its Owner) or member. */
  protected readonly cards = computed(() => {
    const me = this.auth.currentUser()?.id;
    return this.store.worlds().map((w) => ({ ...w, owned: w.ownerId === me }));
  });
  protected readonly creating = signal(false);

  constructor() {
    this.store.load();
  }

  /** Enter a World's Entity browser (ADR-0028). */
  protected enter(id: string): void {
    this.router.navigate(['/w', id, 'entities']);
  }

  /** Create a World and open its Home Entity (the server mints it atomically). */
  protected create(): void {
    if (this.creating()) return;
    this.creating.set(true);
    this.store
      .create(this.transloco.translate('worlds.untitled'))
      .pipe(finalize(() => this.creating.set(false)))
      .subscribe({
        next: (world) =>
          this.router.navigate([
            '/w',
            world.id,
            'entities',
            world.homeEntityId,
          ]),
        error: () =>
          this.toaster.show(
            this.transloco.translate('worlds.createError'),
            'error',
          ),
      });
  }
}
