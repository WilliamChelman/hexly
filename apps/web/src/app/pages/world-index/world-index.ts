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
import { WorldsClient } from '../../core/services/worlds.client';
import { ToasterService } from '../../core/services/toaster.service';
import { Button } from '../../ui/button';
import { Eyebrow } from '../../ui/eyebrow';
import { PageHeader } from '../../ui/page-header';
import { Panel } from '../../ui/panel';
import { Icon } from '../../ui/icon/icon';
import { Autofocus } from '../../ui/autofocus';
import { Input } from '../../ui/input';
import { Dialog } from '../../ui/dialog';
import { WorldCard } from './world-card';

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
    PageHeader,
    Panel,
    Icon,
    TranslocoPipe,
    Autofocus,
    Input,
    Dialog,
    WorldCard,
  ],
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
              <app-world-card
                [id]="card.id"
                [name]="card.name"
                [owned]="card.owned"
                [renaming]="renamingId() === card.id"
                (enter)="enter(card.id)"
                (renameStart)="startRename(card.id)"
                (renameSubmit)="commitRename(card.id, $event)"
                (renameCancel)="cancelRename()"
                (delete)="askDelete(card.id, card.name)"
              />
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
