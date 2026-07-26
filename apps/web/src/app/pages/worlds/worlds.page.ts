import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  AuthClient,
  ClientConfigStore,
  WorldStore,
  WorldsClient,
  ToasterService,
  worldDashboardRoute,
  worldRoute,
  worldSettingsRoute,
} from '@hexly/web-core';
import { ImportSummary } from '@hexly/domain';
import { ENTITY_TYPES } from '@hexly/web-entity';
import {
  ButtonComponent,
  EyebrowComponent,
  PanelComponent,
  IconComponent,
  AutofocusDirective,
  FieldComponent,
  InputComponent,
  DialogComponent,
  SelectComponent,
  ACCENT_SIGIL,
  accentFor,
  monogram,
} from '@hexly/web-ui';

/**
 * The World Index (`/`): lists every World the caller can reach — owned and member — and owns
 * World create. Zero Worlds shows an empty state with a Create affordance, never an auto-redirect.
 */
@Component({
  selector: 'app-worlds',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    EyebrowComponent,
    PanelComponent,
    IconComponent,
    TranslocoPipe,
    AutofocusDirective,
    FieldComponent,
    InputComponent,
    DialogComponent,
    SelectComponent,
    RouterLink,
    NgTemplateOutlet,
  ],
  host: { class: 'block min-h-full bg-surface-sunken' },
  template: `
    <!-- One hidden picker, shared by every Import affordance. -->
    <input
      #vaultInput
      type="file"
      accept=".zip,application/zip"
      class="hidden"
      data-testid="import-vault-input"
      [attr.aria-label]="'worlds.import' | transloco"
      (change)="onVaultPicked($event)"
    />
    <!-- Page actions, defined once and placed by both the header and the empty state. -->
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
        (click)="promptCreate()"
      >
        <app-icon name="plus" [size]="16" />
        {{ (creating() ? 'worldIndex.creating' : 'worlds.new') | transloco }}
      </button>
    </ng-template>
    @if (cards().length > 0) {
      <header class="bg-linear-[180deg] from-surface to-bg-deep border-b border-line">
        <div class="max-w-[64rem] mx-auto px-8 py-16 flex items-end justify-between gap-8">
          <div>
            <span appEyebrow class="text-gold! tracking-[0.28em]">{{ 'worldIndex.eyebrow' | transloco }}</span>
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
                <div class="h-20 flex items-center justify-center {{ sigil(card.id) }}">
                  <span class="font-cartouche text-2xl">{{ mono(card.name) }}</span>
                </div>
                @if (renamingId() === card.id) {
                  <input
                    type="text"
                    appAutofocus
                    class="m-3 font-display text-md text-ink-strong bg-surface-sunken border border-gold rounded-sm py-1 px-2 outline-none"
                    [value]="card.name"
                    [attr.data-testid]="'rename-world-input-' + card.id"
                    [attr.aria-label]="'worldIndex.renameLabel' | transloco"
                    (keydown.enter)="commitRename(card.id, $any($event.target).value)"
                    (keydown.escape)="cancelRename()"
                  />
                } @else {
                  <!-- Stretched link (inset ::after) makes the whole card open the
                       World; action buttons sit outside the anchor, lifted with
                       z-10, so there are no nested interactives (a11y). -->
                  <a
                    class="flex-1 px-3 pt-2 no-underline outline-none focus-visible:shadow-none after:content-[''] after:absolute after:inset-0"
                    [routerLink]="dashboardRoute(card.id, card.name)"
                    [attr.data-testid]="'world-' + card.id"
                    [attr.aria-label]="card.name"
                  >
                    <span class="font-display text-md text-ink-strong line-clamp-2">{{ card.name }}</span>
                  </a>
                }
                <div class="flex items-center gap-1 px-3 pb-2">
                  <span
                    class="text-2xs uppercase tracking-wider"
                    [class.text-gold]="card.owned"
                    [class.text-ink-faint]="!card.owned"
                    [attr.data-testid]="(card.owned ? 'owned-' : 'member-') + card.id"
                    >{{ (card.owned ? 'worldIndex.owned' : 'worldIndex.member') | transloco }}</span
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
                        [routerLink]="settingsRoute(card.id, card.name)"
                        [attr.data-testid]="'owners-world-' + card.id"
                        [attr.aria-label]="'collab.owners.heading' | transloco"
                        [attr.title]="'collab.owners.heading' | transloco"
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
                        [attr.title]="'collab.members.leave' | transloco"
                        (click)="leaveWorld(card.id)"
                      >
                        {{ 'collab.members.leave' | transloco }}
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
                (click)="promptCreate()"
              >
                <app-icon name="plus" [size]="24" />
                <span class="font-display text-md">{{ 'worlds.new' | transloco }}</span>
              </button>
            </li>
          }
        </ul>
      </main>
    } @else if (loadError()) {
      <main class="max-w-[60rem] mx-auto py-8 px-6">
        <section class="p-8 text-center text-ink-muted" data-testid="load-error" appPanel>
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

    @if (naming()) {
      <!-- Naming is the first act of worldbuilding, so create asks before it writes;
           an unnamed World still lands, under the untitled default. -->
      <app-dialog
        [open]="true"
        [heading]="'worldIndex.createHeading' | transloco"
        (closed)="cancelCreate()"
        data-testid="create-world-modal"
      >
        <label class="flex flex-col gap-1 text-sm text-ink-muted">
          {{ 'worldIndex.createNameLabel' | transloco }}
          <input
            type="text"
            appAutofocus
            appInput
            data-testid="create-world-name"
            [value]="newName()"
            [attr.placeholder]="'worlds.untitled' | transloco"
            (input)="newName.set($any($event.target).value)"
            (keydown.enter)="create()"
          />
        </label>
        <button
          dialogFooter
          type="button"
          appButton
          variant="default"
          data-testid="cancel-create-world"
          (click)="cancelCreate()"
        >
          {{ 'common.cancel' | transloco }}
        </button>
        <button
          dialogFooter
          type="button"
          appButton
          variant="primary"
          data-testid="confirm-create-world"
          [disabled]="creating()"
          (click)="create()"
        >
          {{ (creating() ? 'worldIndex.creating' : 'common.create') | transloco }}
        </button>
      </app-dialog>
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
          {{ 'worldIndex.deleteConfirmPrompt' | transloco: { name: target.name } }}
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
        <!-- aria-disabled (not disabled) keeps the gated button in the tab order
             and announced; confirmDelete() guards the action. -->
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

    @if (pendingVault()) {
      <!-- The one moment a bulk decision is made, so it is the moment the author can see and change
           it (ADR-0073). All three apply to this run only; nothing here is persisted. -->
      <app-dialog
        [open]="true"
        [heading]="'worlds.importOptionsHeading' | transloco"
        (closed)="cancelImport()"
        data-testid="import-options"
      >
        <label class="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            class="mt-0.5 accent-gold"
            data-testid="import-create-unresolved"
            [checked]="createUnresolved()"
            (change)="createUnresolved.set($any($event.target).checked)"
          />
          <span class="flex flex-col gap-0.5">
            {{ 'worlds.importCreateUnresolved' | transloco }}
            <span class="text-xs text-ink-muted">{{ 'worlds.importCreateUnresolvedHint' | transloco }}</span>
          </span>
        </label>
        <!-- Both overrides are dead while the switch is off: nothing is created to carry them. -->
        <label appField [label]="'worlds.importInlineType' | transloco">
          <select
            appSelect
            class="w-full"
            data-testid="import-inline-type"
            [disabled]="!createUnresolved()"
            (change)="inlineType.set($any($event.target).value)"
          >
            <!-- [selected] per-option, not [value] on the select: a value binding applies before the
                 <option> children exist in the same change-detection pass and silently no-ops. -->
            @for (type of typeOptions(); track type.id) {
              <option [value]="type.id" [selected]="type.id === inlineType()">{{ type.label }}</option>
            }
          </select>
        </label>
        <!-- Free text, not a picker over the World's tags: the World is minted by this import and has
             none yet (ADR-0073). -->
        <label appField [label]="'worlds.importInlineTag' | transloco">
          <input
            type="text"
            appInput
            data-testid="import-inline-tag"
            [value]="inlineTag()"
            [disabled]="!createUnresolved()"
            [attr.placeholder]="'worlds.importInlineTagHint' | transloco"
            (input)="inlineTag.set($any($event.target).value)"
            (keydown.enter)="confirmImport()"
          />
        </label>
        <button
          dialogFooter
          type="button"
          appButton
          variant="default"
          data-testid="cancel-import"
          (click)="cancelImport()"
        >
          {{ 'common.cancel' | transloco }}
        </button>
        <button
          dialogFooter
          type="button"
          appButton
          variant="primary"
          data-testid="confirm-import"
          (click)="confirmImport()"
        >
          {{ 'worlds.importConfirm' | transloco }}
        </button>
      </app-dialog>
    }

    @if (importSummary(); as summary) {
      <!-- The import's "what did we lose" report, shown before entering the new World. -->
      <app-dialog
        [open]="true"
        [heading]="'worlds.importSummaryHeading' | transloco"
        (closed)="dismissImport()"
        data-testid="import-summary"
      >
        <dl class="grid grid-cols-[1fr_auto] gap-x-8 gap-y-1 text-sm text-ink-muted m-0">
          <dt>{{ 'worlds.importNotes' | transloco }}</dt>
          <dd class="m-0 text-ink text-right">{{ summary.notesImported }}</dd>
          <dt>{{ 'worlds.importLinksResolved' | transloco }}</dt>
          <dd class="m-0 text-ink text-right">{{ summary.linksResolved }}</dd>
          <!-- What the create-unresolved switch actually did (ADR-0073), beside what it didn't. -->
          <dt>{{ 'worlds.importLinksCreated' | transloco }}</dt>
          <dd class="m-0 text-ink text-right" data-testid="import-links-created">{{ summary.linksCreated }}</dd>
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
export class WorldsPage {
  private readonly store = inject(WorldStore);
  private readonly worldsClient = inject(WorldsClient);
  private readonly auth = inject(AuthClient);
  // The server 403s creation without the capability; the affordances hide to match.
  protected readonly canCreateWorlds = this.auth.canCreateWorlds;
  private readonly router = inject(Router);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);
  private readonly config = inject(ClientConfigStore);
  private readonly types = inject(ENTITY_TYPES);

  protected readonly loaded = this.store.loaded;
  protected readonly loadError = this.store.loadError;
  protected readonly cards = computed(() =>
    this.store.worlds().map((w) => ({ ...w, owned: !!w.rights?.includes('manage') })),
  );
  protected readonly sorted = computed(() => [...this.cards()].sort((a, b) => b.updatedAt - a.updatedAt));

  /** Display name derived from the signed-in user's email local part. */
  protected who(): string {
    const local = (this.auth.currentUser()?.email ?? '').split('@')[0];
    return local
      ? local.charAt(0).toUpperCase() + local.slice(1)
      : this.transloco.translate('worldIndex.greetingFallback');
  }

  protected readonly dashboardRoute = worldDashboardRoute;
  protected readonly settingsRoute = worldSettingsRoute;

  protected sigil(id: string): string {
    return ACCENT_SIGIL[accentFor(id)];
  }
  protected readonly mono = monogram;
  protected readonly creating = signal(false);
  protected readonly importing = signal(false);
  protected readonly exportingId = signal<string | null>(null);
  protected readonly importSummary = signal<ImportSummary | null>(null);
  /** The picked `.zip`, held while the options dialog is open — cancelling drops it unuploaded. */
  protected readonly pendingVault = signal<File | null>(null);
  protected readonly createUnresolved = signal(true);
  protected readonly inlineType = signal('');
  protected readonly inlineTag = signal('');

  /**
   * The Types this run may mint under: every registered Type bar the System-managed ones, which the
   * system alone assigns (ADR-0068). The Instance's own `inlineType` joins under its raw id when the
   * registry doesn't know it — the knob resolves verbatim with no boot-time validation (ADR-0073), so
   * the control must be able to show what the server would otherwise have used.
   */
  protected readonly typeOptions = computed(() => {
    // Read as a reactive dependency, so the labels re-resolve on a language switch.
    this.transloco.activeLang();
    const registered = this.types
      .all()
      .filter((def) => !def.systemManaged)
      .map((def) => ({ id: def.id, label: this.types.name(def.id) }));
    const configured = this.config.inlineType();
    return configured && !registered.some((option) => option.id === configured)
      ? [{ id: configured, label: configured }, ...registered]
      : registered;
  });
  protected readonly renamingId = signal<string | null>(null);
  protected readonly naming = signal(false);
  protected readonly newName = signal('');
  protected readonly pendingDelete = signal<{
    id: string;
    name: string;
  } | null>(null);
  protected readonly deleteCount = signal<number | null>(null);
  protected readonly confirmText = signal('');
  protected readonly canConfirmDelete = computed(() => this.confirmText() === this.pendingDelete()?.name);

  constructor() {
    this.store.load();

    // Refetch the worlds list when the tab becomes visible again, so a World
    // created/renamed/deleted elsewhere shows without a hard reload. Component-
    // scoped listener, torn down on navigate-away.
    const onVisible = () => {
      if (document.visibilityState === 'visible') this.store.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('visibilitychange', onVisible));
  }

  protected startRename(id: string): void {
    this.renamingId.set(id);
  }

  protected cancelRename(): void {
    this.renamingId.set(null);
  }

  /** A blank, unchanged, or vanished card closes the input without a round trip. */
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
        this.toaster.show(this.transloco.translate('worldIndex.renameError'), 'error');
      },
    });
  }

  /** Open the type-to-confirm delete modal; the World Detail supplies the
   * entity count it would destroy. */
  protected askDelete(id: string, name: string): void {
    this.pendingDelete.set({ id, name });
    this.deleteCount.set(null);
    this.confirmText.set('');
    this.worldsClient.get(id).subscribe({
      next: (world) => this.deleteCount.set(world.entityCount),
      error: () => {
        this.cancelDelete();
        this.toaster.show(this.transloco.translate('worldIndex.deleteError'), 'error');
      },
    });
  }

  protected cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  protected leaveWorld(id: string): void {
    this.store.leave(id).subscribe({
      error: () => this.toaster.show(this.transloco.translate('collab.members.leaveError'), 'error'),
    });
  }

  /** Deleting a World cascades its Entities. */
  protected confirmDelete(): void {
    const target = this.pendingDelete();
    if (!target || !this.canConfirmDelete()) return;
    this.store.delete(target.id).subscribe({
      next: () => this.cancelDelete(),
      error: () => {
        this.cancelDelete();
        this.toaster.show(this.transloco.translate('worldIndex.deleteError'), 'error');
      },
    });
  }

  /** Open the name prompt; the World is written only once the author confirms. */
  protected promptCreate(): void {
    this.newName.set('');
    this.naming.set(true);
  }

  protected cancelCreate(): void {
    this.naming.set(false);
  }

  /** A blank name falls back to the untitled default, as elsewhere at create time. */
  protected create(): void {
    if (this.creating()) return;
    this.creating.set(true);
    this.store
      .create(this.newName().trim() || this.transloco.translate('worlds.untitled'))
      .pipe(finalize(() => this.creating.set(false)))
      .subscribe({
        next: (world) => {
          this.naming.set(false);
          this.router.navigate(worldDashboardRoute(world.id, world.name));
        },
        // The prompt stays open on failure, so a retry keeps the typed name.
        error: () => this.toaster.show(this.transloco.translate('worlds.createError'), 'error'),
      });
  }

  /**
   * A picked vault opens the options dialog rather than uploading (ADR-0073): the create-unresolved
   * switch has to be reachable *before* the import, so a vault can come across creating nothing the
   * author did not write. The three controls are re-seeded from the Instance defaults on every pick,
   * which is what keeps a run's overrides from surviving to the next one.
   *
   * The input is cleared so re-picking the same file fires `change` again.
   */
  protected onVaultPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.importing()) return;
    this.createUnresolved.set(true);
    // `inlineType` reads `undefined` only when `/api/config` never landed; the first offered Type is
    // then sent verbatim, so what the control shows is still what the run does.
    this.inlineType.set(this.config.inlineType() ?? this.typeOptions()[0]?.id ?? '');
    this.inlineTag.set(this.config.inlineTag() ?? '');
    this.pendingVault.set(file);
  }

  /** Dropping the held file uploads nothing — the vault never left the browser. */
  protected cancelImport(): void {
    this.pendingVault.set(null);
  }

  /** Import the held vault `.zip` into a fresh World, under this run's options. */
  protected confirmImport(): void {
    const file = this.pendingVault();
    if (!file || this.importing()) return;
    this.pendingVault.set(null);
    this.importing.set(true);
    this.worldsClient
      .importVault(file, {
        createUnresolved: this.createUnresolved(),
        inlineType: this.inlineType(),
        inlineTag: this.inlineTag(),
      })
      .pipe(finalize(() => this.importing.set(false)))
      .subscribe({
        next: (summary) => this.importSummary.set(summary),
        error: () => this.toaster.show(this.transloco.translate('worlds.importError'), 'error'),
      });
  }

  /** Export a World to a `.zip` browser download. Owner-only, gated in the
   * template; the server also refuses a non-owner. */
  protected exportWorld(id: string, name: string): void {
    if (this.exportingId()) return;
    this.exportingId.set(id);
    this.worldsClient
      .exportVault(id)
      .pipe(finalize(() => this.exportingId.set(null)))
      .subscribe({
        next: (blob) => saveBlob(blob, `${name}.zip`),
        error: () => this.toaster.show(this.transloco.translate('worlds.exportError'), 'error'),
      });
  }

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

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
