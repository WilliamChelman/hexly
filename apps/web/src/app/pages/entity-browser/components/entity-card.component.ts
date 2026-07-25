import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EntityType, EntityVerb } from '@hexly/domain';
import { HexlyDatePipe } from '@hexly/web-core';
import {
  AutofocusDirective,
  ButtonComponent,
  PanelComponent,
  IconComponent,
  IconName,
  ACCENT_BAR,
  ACCENT_SIGIL,
  accentFor,
} from '@hexly/web-ui';
import { TypeRegistry } from '../../../entity-types/type-registry';

/** A row of the Entity browser grid — the parent owns list/order, the card owns
 * the tile. The last-edited instant stays raw; the template formats it via
 * `| hexlyDate` so it tracks the user's Format Locale live (ADR-0038). */
export interface EntityCardVm {
  id: string;
  title: string;
  type: EntityType;
  tags: readonly string[];
  updatedAt: number;
  /** The caller's Rights on this Entity (ADR-0039) — gates the rename/delete actions. */
  rights?: readonly EntityVerb[];
  /** The resolved Thumbnail URL (ADR-0066), present only when the list opted into thumbnails and one
   * resolved; absent → the sigil falls back to the primary type's icon. Always safe as an `<img src>`. */
  thumbnailUrl?: string;
  /** **Missing Bytes** on this Entity's own bytes (#325) — its resolved URL is known to 404, so the sigil wins. */
  assetBytesMissing?: boolean;
}

/**
 * One Entity tile: the sigil accent, the stretched open-link, type + last-edited meta, the hover
 * rename/delete actions, and the in-place rename input. List, order, and rename state live in
 * {@link EntityBrowser}; the card renders a {@link EntityCardVm} and emits intent. `display: contents`
 * on the host so the `<section>` is the parent `<li>`'s grid child directly.
 */
@Component({
  selector: 'app-entity-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    PanelComponent,
    IconComponent,
    AutofocusDirective,
    TranslocoPipe,
    RouterLink,
    HexlyDatePipe,
  ],
  host: { class: 'contents' },
  template: `
    <section
      class="group relative flex gap-4 p-4 pl-6 overflow-hidden h-full transition-shadow hover:shadow-3 has-[a:focus-visible]:[outline:2px_solid_var(--color-gold)] has-[a:focus-visible]:outline-offset-2"
      appPanel
      raised
    >
      <span class="absolute left-0 top-0 bottom-0 w-1.5 {{ bar() }}"></span>
      <!-- The Thumbnail stands in for the type icon so a card is recognizable by sight (ADR-0066);
           absent — no designation, no own bytes, or a dangling link the server already dropped — the
           primary type's sigil renders instead, never a broken image. Own bytes reported as **Missing
           Bytes** count as absent (#325): the URL resolves but is known to 404. -->
      @if (card().thumbnailUrl && !card().assetBytesMissing) {
        <img
          class="shrink-0 size-12 rounded-full object-cover bg-surface-sunken"
          loading="lazy"
          draggable="false"
          [src]="card().thumbnailUrl"
          [attr.data-testid]="'thumbnail-' + card().id"
          alt=""
        />
      } @else {
        <span
          class="shrink-0 size-12 rounded-full flex items-center justify-center {{ sigil() }}"
          data-testid="type-sigil"
        >
          <app-icon [name]="typeIcon()" [size]="20" />
        </span>
      }
      <div class="min-w-0 flex-1">
        @if (renaming()) {
          <input
            type="text"
            appAutofocus
            class="w-full font-display text-md text-ink-strong bg-surface-sunken border border-gold rounded-sm py-1 px-2 outline-none"
            [value]="card().title"
            [attr.data-testid]="'rename-input-' + card().id"
            [attr.aria-label]="'entityBrowser.renameLabel' | transloco"
            (keydown.enter)="commitRename.emit($any($event.target).value)"
            (keydown.escape)="cancelRename.emit()"
          />
        } @else {
          <!-- Stretched link (inset ::after) makes the whole tile open the Entity;
               the action buttons sit OUTSIDE this anchor, lifted above the overlay
               with z-10 so they stay clickable and the markup keeps no nested
               interactives (a11y). -->
          <a
            class="block w-full no-underline outline-none focus-visible:shadow-none after:content-[''] after:absolute after:inset-0"
            [routerLink]="['/w', worldId(), 'entities', card().id]"
            [attr.data-testid]="'open-' + card().id"
            [attr.aria-label]="card().title"
          >
            <span
              class="font-display text-lg text-ink-strong leading-tight line-clamp-2 group-hover:text-gold transition-colors"
              data-testid="entity-title"
              >{{ card().title }}</span
            >
          </a>
          <hr class="border-0 border-t border-line my-2" />
          <div class="flex items-center gap-2">
            <span class="text-2xs uppercase tracking-wider text-ink-muted" [attr.data-testid]="'type-' + card().id">{{
              typeLabel()
            }}</span>
            <span class="text-2xs text-ink-faint">·</span>
            <span class="meta text-2xs text-ink-muted">{{
              'entityBrowser.edited' | transloco: { date: (card().updatedAt | hexlyDate) }
            }}</span>
            <!-- Rename gates on the edit verb (substance), delete on the delete verb
                 (ADR-0039): a reader never sees an action the server would 403. -->
            <span
              class="relative z-10 ml-auto flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
            >
              @if (canRename()) {
                <button
                  type="button"
                  appButton
                  icon
                  variant="ghost"
                  size="sm"
                  [attr.data-testid]="'rename-' + card().id"
                  [attr.aria-label]="'entityBrowser.rename' | transloco"
                  [attr.title]="'entityBrowser.rename' | transloco"
                  (click)="startRename.emit()"
                >
                  <app-icon name="label" [size]="16" />
                </button>
              }
              @if (canDelete()) {
                <button
                  type="button"
                  appButton
                  icon
                  variant="ghost"
                  size="sm"
                  danger
                  [attr.data-testid]="'delete-' + card().id"
                  [attr.aria-label]="'common.delete' | transloco"
                  [attr.title]="'common.delete' | transloco"
                  (click)="remove.emit()"
                >
                  <app-icon name="erase" [size]="16" />
                </button>
              }
            </span>
          </div>
          @if (card().tags.length > 0) {
            <span class="flex flex-wrap gap-1 mt-2" [attr.data-testid]="'tags-' + card().id">
              @for (tag of card().tags; track tag) {
                <span class="text-2xs text-ink-muted bg-surface-sunken rounded-sm py-px px-1">{{ tag }}</span>
              }
            </span>
          }
        }
      </div>
    </section>
  `,
})
export class EntityCardComponent {
  readonly card = input.required<EntityCardVm>();
  /** The active World, so the tile links to `/w/:worldId/entities/:id`. */
  readonly worldId = input.required<string | null>();
  /** True while this card's title is being edited in place. */
  readonly renaming = input(false);

  readonly startRename = output<void>();
  /** Emits the new name on Enter; the parent validates and persists it. */
  readonly commitRename = output<string>();
  readonly cancelRename = output<void>();
  readonly remove = output<void>();

  private readonly types = inject(TypeRegistry);
  private readonly transloco = inject(TranslocoService);

  protected readonly bar = computed(() => ACCENT_BAR[accentFor(this.card().id)]);
  protected readonly sigil = computed(() => ACCENT_SIGIL[accentFor(this.card().id)]);
  /** The Entity type's registered icon (a hex map reads as terrain, a note as a label). */
  protected readonly typeIcon = computed<IconName>(() => this.types.resolve(this.card().type).icon);
  /** The primary type's display name, resolved by the registry (a user-defined name is never translated). */
  protected readonly typeLabel = computed(() => {
    this.transloco.activeLang(); // reactive dependency: re-resolve on a language switch
    return this.types.name(this.card().type);
  });
  /** Rename is a substance edit; delete the lifecycle verb (ADR-0039). Absent Rights → hidden (fail-closed). */
  protected readonly canRename = computed(() => !!this.card().rights?.includes('edit'));
  protected readonly canDelete = computed(() => !!this.card().rights?.includes('delete'));
}
