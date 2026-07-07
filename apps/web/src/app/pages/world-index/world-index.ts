import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AuthClient } from '../../core/services/auth.client';
import { WorldStore } from '../../core/services/world.store';
import { WorldsClient } from '../../core/services/worlds.client';
import { ToasterService } from '../../core/services/toaster.service';
import { ImportSummary } from '@hexly/domain';
import { worldDashboardRoute, worldRoute } from '../../core/utils/routes';
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
 * around. Owned-vs-member is derived by testing whether the current user is in each
 * World's `owners` set (ADR-0037). Both creating a World and opening an existing one's
 * card land on the World Dashboard (ADR-0043).
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
    NgTemplateOutlet,
  ],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <!-- One hidden picker, triggered by every Import affordance (a top-level ref is
         in scope across the whole template, including inside the @if branches). -->
    <input
      #vaultInput
      type="file"
      accept=".zip,application/zip"
      class="hidden"
      data-testid="import-vault-input"
      [attr.aria-label]="'worlds.import' | transloco"
      (change)="onVaultPicked($event)"
    />
    <!-- The two page actions, defined once and placed (in either order) by the
         populated header and the empty state below. -->
    <ng-template #importBtn>
      <button
        type="button"
        appButton
        variant="default"
        data-testid="import-vault"
        [disabled]="importing()"
        (click)="vaultInput.click()"
      >
        <app-icon name="upload" [size]="16" />
        {{ (importing() ? 'worlds.importing' : 'worlds.import') | transloco }}
      </button>
    </ng-template>
    <ng-template #createBtn>
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
    </ng-template>
    @if (cards().length > 0) {
      <header
        class="bg-linear-[180deg] from-surface to-bg-deep border-b border-line"
      >
        <div
          class="max-w-[64rem] mx-auto px-8 py-16 flex items-end justify-between gap-8"
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
          @if (canCreateWorlds()) {
            <div class="flex items-center gap-2">
              <ng-container [ngTemplateOutlet]="importBtn" />
              <ng-container [ngTemplateOutlet]="createBtn" />
            </div>
          }
        </div>
      </header>

      <main class="max-w-[64rem] mx-auto px-8 py-8">
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
                    class="flex-1 px-3 pt-2 no-underline outline-none focus-visible:shadow-none after:content-[''] after:absolute after:inset-0"
                    [routerLink]="dashboardRoute(card.id, card.name)"
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
                      <a
                        appButton
                        icon
                        variant="ghost"
                        size="sm"
                        [routerLink]="['/w', card.id, 'settings']"
                        [attr.data-testid]="'owners-world-' + card.id"
                        [attr.aria-label]="'owners.heading' | transloco"
                        [attr.title]="'owners.heading' | transloco"
                      >
                        <app-icon name="user" [size]="16" />
                      </a>
                      <button
                        type="button"
                        appButton
                        icon
                        variant="ghost"
                        size="sm"
                        [disabled]="exportingId() === card.id"
                        [attr.data-testid]="'export-world-' + card.id"
                        [attr.aria-label]="'worlds.export' | transloco"
                        [attr.title]="'worlds.export' | transloco"
                        (click)="exportWorld(card.id, card.name)"
                      >
                        <app-icon name="download" [size]="16" />
                      </button>
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
                  } @else {
                    <span
                      class="relative z-10 ml-auto flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                    >
                      <button
                        type="button"
                        appButton
                        variant="ghost"
                        size="sm"
                        danger
                        [attr.data-testid]="'leave-world-' + card.id"
                        [attr.title]="'members.leave' | transloco"
                        (click)="leaveWorld(card.id)"
                      >
                        {{ 'members.leave' | transloco }}
                      </button>
                    </span>
                  }
                </div>
              </div>
            </li>
          }
          @if (canCreateWorlds()) {
            <li class="snap-start shrink-0 w-56">
              <button
                type="button"
                class="h-44 w-full rounded-lg border border-dashed border-line-strong text-ink-muted hover:text-gold hover:border-gold bg-surface-sunken/40 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors outline-none focus-visible:shadow-none focus-visible:[outline:2px_solid_var(--color-gold)] focus-visible:[outline-offset:-2px]"
                [disabled]="creating()"
                (click)="create()"
              >
                <app-icon name="plus" [size]="24" />
                <span class="font-display text-md">{{
                  'worlds.new' | transloco
                }}</span>
              </button>
            </li>
          }
        </ul>
      </main>
    } @else if (loadError()) {
      <main class="max-w-[60rem] mx-auto py-8 px-6">
        <section
          class="p-8 text-center text-ink-muted"
          data-testid="load-error"
          appPanel
        >
          <p>{{ 'worldIndex.loadErrorTitle' | transloco }}</p>
          <p class="text-sm">{{ 'worldIndex.loadErrorHint' | transloco }}</p>
        </section>
      </main>
    } @else if (loaded()) {
      <main class="max-w-[60rem] mx-auto py-8 px-6">
        <section
          class="p-16 text-center text-ink-muted flex flex-col items-center gap-3"
          data-testid="worlds-empty"
          appPanel
        >
          <p class="m-0">{{ 'worldIndex.emptyTitle' | transloco }}</p>
          <p class="text-sm m-0">{{ 'worldIndex.emptyHint' | transloco }}</p>
          @if (canCreateWorlds()) {
            <div class="flex items-center gap-2">
              <ng-container [ngTemplateOutlet]="createBtn" />
              <ng-container [ngTemplateOutlet]="importBtn" />
            </div>
          }
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

    @if (importSummary(); as summary) {
      <!-- The import's "what did we lose" report (ADR-0033), surfaced before the
           user enters the new World. -->
      <app-dialog
        [open]="true"
        [heading]="'worlds.importSummaryHeading' | transloco"
        (closed)="dismissImport()"
        data-testid="import-summary"
      >
        <dl
          class="grid grid-cols-[1fr_auto] gap-x-8 gap-y-1 text-sm text-ink-muted m-0"
        >
          <dt>{{ 'worlds.importNotes' | transloco }}</dt>
          <dd class="m-0 text-ink text-right">{{ summary.notesImported }}</dd>
          <dt>{{ 'worlds.importLinksResolved' | transloco }}</dt>
          <dd class="m-0 text-ink text-right">{{ summary.linksResolved }}</dd>
          <dt>{{ 'worlds.importLinksDangling' | transloco }}</dt>
          <dd class="m-0 text-ink text-right">{{ summary.linksDangling }}</dd>
          <dt>{{ 'worlds.importAssets' | transloco }}</dt>
          <dd class="m-0 text-ink text-right">{{ summary.assetsStored }}</dd>
          @if (summary.filesSkipped > 0) {
            <dt>{{ 'worlds.importSkipped' | transloco }}</dt>
            <dd class="m-0 text-ink text-right">{{ summary.filesSkipped }}</dd>
          }
        </dl>
        <button
          dialogFooter
          type="button"
          appButton
          variant="primary"
          data-testid="open-imported"
          (click)="openImported()"
        >
          {{ 'worlds.openImported' | transloco }}
        </button>
      </app-dialog>
    }
  `,
})
export class WorldIndex {
  private readonly store = inject(WorldStore);
  private readonly worldsClient = inject(WorldsClient);
  private readonly auth = inject(AuthClient);
  // World Creation capability (ADR-0040): gates every "New World" / import affordance —
  // the server 403s a creation attempt without it, so the button is hidden to match.
  protected readonly canCreateWorlds = this.auth.canCreateWorlds;
  private readonly router = inject(Router);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  protected readonly loaded = this.store.loaded;
  protected readonly loadError = this.store.loadError;
  /** The reachable Worlds, each tagged owned (caller holds the `manage` Right, ADR-0039) or member. */
  protected readonly cards = computed(() =>
    this.store.worlds().map((w) => ({ ...w, owned: !!w.rights?.includes('manage') })),
  );
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

  /** The World's Dashboard landing (ADR-0043) — the one `/w/:id` source, name-slugged. */
  protected readonly dashboardRoute = worldDashboardRoute;

  protected sigil(id: string): string {
    return ACCENT_SIGIL[accentFor(id)];
  }
  protected readonly mono = monogram;
  protected readonly creating = signal(false);
  /** True while a vault import is in flight — drives the Import affordance's spinner. */
  protected readonly importing = signal(false);
  /** The id of the World whose export is in flight, if any — disables that card's Export button. */
  protected readonly exportingId = signal<string | null>(null);
  /** The last import's result, shown in a summary modal until the user opens the World or dismisses it. */
  protected readonly importSummary = signal<ImportSummary | null>(null);
  protected readonly renamingId = signal<string | null>(null);
  protected readonly pendingDelete = signal<{ id: string; name: string } | null>(
    null,
  );
  protected readonly deleteCount = signal<number | null>(null);
  protected readonly confirmText = signal('');
  /** Delete is armed only once the typed name matches the World's exactly. */
  protected readonly canConfirmDelete = computed(
    () => this.confirmText() === this.pendingDelete()?.name,
  );

  constructor() {
    this.store.load();

    // Live-follow for the durable directory, off the nudge bus (ADR-0044): returning to
    // the tab refetches the worlds list, so a World created/renamed/deleted elsewhere
    // shows without a hard reload. `visibilitychange` fires only on hidden↔visible
    // transitions, so guarding on `visible` refetches on re-focus without firing while
    // the tab is already active. The listener lives on the Index component, so it's
    // scoped to `/` and torn down on navigate-away.
    const onVisible = () => {
      if (document.visibilityState === 'visible') this.store.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() =>
      document.removeEventListener('visibilitychange', onVisible),
    );
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
   * closes the input without a round trip. On error, toasts.
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

  /** Leave a World the caller is a member (not Owner) of (ADR-0037, #159), self-service. */
  protected leaveWorld(id: string): void {
    this.store.leave(id).subscribe({
      error: () =>
        this.toaster.show(this.transloco.translate('members.leaveError'), 'error'),
    });
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

  /** Create a World and land on its Dashboard (ADR-0043). */
  protected create(): void {
    if (this.creating()) return;
    this.creating.set(true);
    this.store
      .create(this.transloco.translate('worlds.untitled'))
      .pipe(finalize(() => this.creating.set(false)))
      .subscribe({
        next: (world) =>
          this.router.navigate(worldDashboardRoute(world.id, world.name)),
        error: () =>
          this.toaster.show(
            this.transloco.translate('worlds.createError'),
            'error',
          ),
      });
  }

  /**
   * Import the picked Obsidian vault `.zip` into a fresh World (ADR-0033). Runs
   * synchronously server-side behind a spinner; on success the {@link ImportSummary}
   * opens a modal (the "what did we lose" report) whose action lands in the new World.
   * The input is cleared so re-picking the same file fires `change` again.
   */
  protected onVaultPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.importing()) return;
    this.importing.set(true);
    this.worldsClient
      .importVault(file)
      .pipe(finalize(() => this.importing.set(false)))
      .subscribe({
        next: (summary) => this.importSummary.set(summary),
        error: () =>
          this.toaster.show(
            this.transloco.translate('worlds.importError'),
            'error',
          ),
      });
  }

  /**
   * Export a World to a `.zip` and save it as a browser download (ADR-0033, #150).
   * The download is named after the World; a failure just toasts. Owner-only, gated
   * in the template — the server also refuses a non-owner (403).
   */
  protected exportWorld(id: string, name: string): void {
    if (this.exportingId()) return;
    this.exportingId.set(id);
    this.worldsClient
      .exportVault(id)
      .pipe(finalize(() => this.exportingId.set(null)))
      .subscribe({
        next: (blob) => saveBlob(blob, `${name}.zip`),
        error: () =>
          this.toaster.show(
            this.transloco.translate('worlds.exportError'),
            'error',
          ),
      });
  }

  /** Leave the summary modal and enter the freshly imported World's Entity browser. */
  protected openImported(): void {
    const summary = this.importSummary();
    if (!summary) return;
    this.importSummary.set(null);
    this.router.navigate(worldRoute(summary.worldId));
  }

  protected dismissImport(): void {
    this.importSummary.set(null);
  }
}

/** Save a blob as a browser download under `filename` (the app's only blob-download, #150). */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
