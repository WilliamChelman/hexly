import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AuthClient } from '../../core/services/auth.client';
import { WorldStore } from '../../core/services/world.store';
import { WorldsClient } from '../../core/services/worlds.client';
import { ToasterService } from '../../core/services/toaster.service';
import { Button } from '../../ui/button';
import { Eyebrow } from '../../ui/eyebrow';
import { Panel } from '../../ui/panel';
import { Icon } from '../../ui/icon/icon';
import { Autofocus } from '../../ui/autofocus';
import { Input } from '../../ui/input';
import { Dialog } from '../../ui/dialog';
import { ACCENT_SIGIL, accentFor, monogram } from '../../ui/sigil';

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
  imports: [
    Button,
    Eyebrow,
    Panel,
    Icon,
    TranslocoPipe,
    Autofocus,
    Input,
    Dialog,
    RouterLink,
  ],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    @if (cards().length > 0) {
      <header
        class="bg-linear-[180deg] from-surface to-bg-deep border-b border-line"
      >
        <div
          class="max-w-[64rem] mx-auto px-6 py-8 flex items-end justify-between gap-6"
        >
          <div>
            <span appEyebrow class="text-gold! tracking-[0.28em]">{{
              'worldIndex.eyebrow' | transloco
            }}</span>
            <h1 class="font-display text-3xl text-ink-strong m-0 leading-tight">
              {{ 'worldIndex.greeting' | transloco: { name: who() } }}
            </h1>
            <p class="text-ink-muted text-base mt-1 mb-0">
              {{ 'worldIndex.subhead' | transloco }}
            </p>
          </div>
          <button
            type="button"
            appButton
            variant="primary"
            data-testid="create-world"
            [disabled]="creating()"
            (click)="create()"
          >
            <app-icon name="plus" [size]="16" />
            {{ (creating() ? 'worldIndex.creating' : 'worlds.new') | transloco }}
          </button>
        </div>
      </header>

      <main class="max-w-[64rem] mx-auto px-6 py-6">
        <h2 appEyebrow mark class="mb-3">
          {{ 'worldIndex.continue' | transloco }}
        </h2>
        <ul class="flex gap-4 overflow-x-auto pb-3 m-0 p-0 list-none snap-x">
          @for (card of sorted(); track card.id) {
            <li class="snap-start shrink-0 w-56">
              <div
                class="group relative h-44 rounded-lg border border-line bg-surface shadow-1 overflow-hidden flex flex-col transition-shadow hover:shadow-2 has-[a:focus-visible]:[outline:2px_solid_var(--color-gold)] has-[a:focus-visible]:[outline-offset:-2px]"
              >
                <div
                  class="h-20 flex items-center justify-center {{
                    sigil(card.id)
                  }}"
                >
                  <span class="font-cartouche text-2xl">{{
                    mono(card.name)
                  }}</span>
                </div>
                @if (renamingId() === card.id) {
                  <input
                    type="text"
                    appAutofocus
                    class="m-3 font-display text-md text-ink-strong bg-surface-sunken border border-gold rounded-sm py-1 px-2 outline-none"
                    [value]="card.name"
                    [attr.data-testid]="'rename-world-input-' + card.id"
                    [attr.aria-label]="'worldIndex.renameLabel' | transloco"
                    (keydown.enter)="
                      commitRename(card.id, $any($event.target).value)
                    "
                    (keydown.escape)="cancelRename()"
                  />
                } @else {
                  <!-- Stretched link (inset ::after) makes the whole card open the
                       World; the action buttons live OUTSIDE this anchor as later
                       siblings, lifted above the overlay with z-10 so they stay
                       independently clickable and the markup keeps no nested
                       interactives (a11y). -->
                  <a
                    class="flex-1 px-3 pt-2 no-underline outline-none focus-visible:[box-shadow:none] after:content-[''] after:absolute after:inset-0"
                    [routerLink]="['/w', card.id, 'entities']"
                    [attr.data-testid]="'world-' + card.id"
                    [attr.aria-label]="card.name"
                  >
                    <span
                      class="font-display text-md text-ink-strong line-clamp-2"
                      >{{ card.name }}</span
                    >
                  </a>
                }
                <div class="flex items-center gap-1 px-3 pb-2">
                  <span
                    class="text-2xs uppercase tracking-wider"
                    [class.text-gold]="card.owned"
                    [class.text-ink-faint]="!card.owned"
                    [attr.data-testid]="
                      (card.owned ? 'owned-' : 'member-') + card.id
                    "
                    >{{
                      (card.owned ? 'worldIndex.owned' : 'worldIndex.member')
                        | transloco
                    }}</span
                  >
                  @if (card.owned) {
                    <span
                      class="relative z-10 ml-auto flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                    >
                      <button
                        type="button"
                        appButton
                        icon
                        variant="ghost"
                        size="sm"
                        [attr.data-testid]="'rename-world-' + card.id"
                        [attr.aria-label]="'worldIndex.rename' | transloco"
                        [attr.title]="'worldIndex.rename' | transloco"
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
                        [attr.data-testid]="'delete-world-' + card.id"
                        [attr.aria-label]="'common.delete' | transloco"
                        [attr.title]="'common.delete' | transloco"
                        (click)="askDelete(card.id, card.name)"
                      >
                        <app-icon name="erase" [size]="16" />
                      </button>
                    </span>
                  }
                </div>
              </div>
            </li>
          }
          <li class="snap-start shrink-0 w-56">
            <button
              type="button"
              class="h-44 w-full rounded-lg border border-dashed border-line-strong text-ink-muted hover:text-gold hover:border-gold bg-surface-sunken/40 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors outline-none focus-visible:[box-shadow:none] focus-visible:[outline:2px_solid_var(--color-gold)] focus-visible:[outline-offset:-2px]"
              [disabled]="creating()"
              (click)="create()"
            >
              <app-icon name="plus" [size]="24" />
              <span class="font-display text-md">{{
                'worlds.new' | transloco
              }}</span>
            </button>
          </li>
        </ul>
      </main>
    } @else if (loadError()) {
      <main class="max-w-[60rem] mx-auto py-6 px-5">
        <section
          class="p-6 text-center text-ink-muted"
          data-testid="load-error"
          appPanel
        >
          <p>{{ 'worldIndex.loadErrorTitle' | transloco }}</p>
          <p class="text-sm">{{ 'worldIndex.loadErrorHint' | transloco }}</p>
        </section>
      </main>
    } @else if (loaded()) {
      <main class="max-w-[60rem] mx-auto py-6 px-5">
        <section
          class="p-8 text-center text-ink-muted flex flex-col items-center gap-3"
          data-testid="worlds-empty"
          appPanel
        >
          <p class="m-0">{{ 'worldIndex.emptyTitle' | transloco }}</p>
          <p class="text-sm m-0">{{ 'worldIndex.emptyHint' | transloco }}</p>
          <button
            type="button"
            appButton
            variant="primary"
            data-testid="create-world"
            [disabled]="creating()"
            (click)="create()"
          >
            <app-icon name="plus" [size]="16" />
            {{ (creating() ? 'worldIndex.creating' : 'worlds.new') | transloco }}
          </button>
        </section>
      </main>
    }

    @if (pendingDelete(); as target) {
      <app-dialog
        [open]="true"
        [heading]="'worldIndex.deleteHeading' | transloco"
        (closed)="cancelDelete()"
        data-testid="delete-modal"
      >
        <p class="text-sm text-ink-muted m-0" data-testid="delete-count">
          @if (deleteCount() === null) {
            {{ 'worldIndex.deleteCounting' | transloco }}
          } @else {
            {{ 'worldIndex.deleteCount' | transloco: { count: deleteCount() } }}
          }
        </p>
        <label class="flex flex-col gap-1 text-sm text-ink-muted">
          {{
            'worldIndex.deleteConfirmPrompt' | transloco: { name: target.name }
          }}
          <input
            type="text"
            appAutofocus
            appInput
            data-testid="delete-confirm-input"
            [attr.aria-label]="'worldIndex.deleteConfirmLabel' | transloco"
            [value]="confirmText()"
            (input)="confirmText.set($any($event.target).value)"
            (keydown.enter)="confirmDelete()"
          />
        </label>
        <button
          dialogFooter
          type="button"
          appButton
          variant="default"
          data-testid="cancel-delete"
          (click)="cancelDelete()"
        >
          {{ 'common.cancel' | transloco }}
        </button>
        <!-- aria-disabled (not the native attribute) keeps the gated button in
             the tab order and announced; confirmDelete() guards the action. -->
        <button
          dialogFooter
          type="button"
          appButton
          danger
          data-testid="confirm-delete"
          [attr.aria-disabled]="!canConfirmDelete() || null"
          (click)="confirmDelete()"
        >
          {{ 'common.delete' | transloco }}
        </button>
      </app-dialog>
    }
  `,
})
export class WorldIndex {
  private readonly store = inject(WorldStore);
  private readonly worldsClient = inject(WorldsClient);
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
  /** The rail order: most-recently-touched World first (continue where you left off). */
  protected readonly sorted = computed(() =>
    [...this.cards()].sort((a, b) => b.updatedAt - a.updatedAt),
  );

  /** A capitalised display name derived from the signed-in user's email local part. */
  protected who(): string {
    const local = (this.auth.currentUser()?.email ?? '').split('@')[0];
    return local
      ? local.charAt(0).toUpperCase() + local.slice(1)
      : this.transloco.translate('worldIndex.greetingFallback');
  }

  protected sigil(id: string): string {
    return ACCENT_SIGIL[accentFor(id)];
  }
  protected readonly mono = monogram;
  protected readonly creating = signal(false);
  /** The World whose name is being edited inline, or `null`. */
  protected readonly renamingId = signal<string | null>(null);
  /** The World pending a type-to-confirm delete, or `null` when the modal is closed. */
  protected readonly pendingDelete = signal<{ id: string; name: string } | null>(
    null,
  );
  /** Entities the pending delete would destroy; `null` while the count is loading. */
  protected readonly deleteCount = signal<number | null>(null);
  /** The name the user has typed into the confirm field. */
  protected readonly confirmText = signal('');
  /** Delete is armed only once the typed name matches the World's exactly. */
  protected readonly canConfirmDelete = computed(
    () => this.confirmText() === this.pendingDelete()?.name,
  );

  constructor() {
    this.store.load();
  }

  /** Open the inline rename input on a World (Owner-only, gated in the template). */
  protected startRename(id: string): void {
    this.renamingId.set(id);
  }

  protected cancelRename(): void {
    this.renamingId.set(null);
  }

  /**
   * Rename a World by name (ADR-0024). A blank, unchanged, or vanished card just
   * closes the input without a round trip; the World name is the source of truth for
   * its Home Entity's title (ADR-0029), reconciled server-side. On error, toasts.
   */
  protected commitRename(id: string, name: string): void {
    const trimmed = name.trim();
    const current = this.store.worlds().find((w) => w.id === id);
    if (!trimmed || !current || trimmed === current.name) {
      this.cancelRename();
      return;
    }
    this.store.rename(id, trimmed).subscribe({
      next: () => this.renamingId.set(null),
      error: () => {
        this.cancelRename();
        this.toaster.show(
          this.transloco.translate('worldIndex.renameError'),
          'error',
        );
      },
    });
  }

  /**
   * Open the type-to-confirm delete modal for a World (Owner-only). Reads the
   * World's Detail for the entity count it would destroy (#120) — a lightweight
   * on-demand read, not a heavy endpoint. A failed count just closes and toasts.
   */
  protected askDelete(id: string, name: string): void {
    this.pendingDelete.set({ id, name });
    this.deleteCount.set(null);
    this.confirmText.set('');
    this.worldsClient.get(id).subscribe({
      next: (world) => this.deleteCount.set(world.entityCount),
      error: () => {
        this.cancelDelete();
        this.toaster.show(
          this.transloco.translate('worldIndex.deleteError'),
          'error',
        );
      },
    });
  }

  protected cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  /** Delete the pending World once the typed name matches; cascades its Entities (ADR-0024). */
  protected confirmDelete(): void {
    const target = this.pendingDelete();
    if (!target || !this.canConfirmDelete()) return;
    this.store.delete(target.id).subscribe({
      next: () => this.cancelDelete(),
      error: () => {
        this.cancelDelete();
        this.toaster.show(
          this.transloco.translate('worldIndex.deleteError'),
          'error',
        );
      },
    });
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
