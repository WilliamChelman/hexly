import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntityType, EntityVerb } from '@hexly/domain';
import { HexlyDatePipe } from '@hexly/web-core';
import { Autofocus, Button, Panel, Icon, IconName, ACCENT_BAR, ACCENT_SIGIL, accentFor } from '@hexly/web-ui';
import { TypeRegistry } from '../../entity-types/type-registry';

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
}

/**
 * One Entity tile: the sigil accent, the stretched open-link, type + last-edited
 * meta, the hover rename/delete actions, and the in-place rename input. Purely
 * presentational — all list, order, and rename state lives in {@link EntityBrowser};
 * the card just renders a {@link EntityCardVm} and emits intent. `display: contents`
 * on the host so the `<section>` is the parent `<li>`'s grid child directly.
 */
@Component({
  selector: 'app-entity-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Panel, Icon, Autofocus, TranslocoPipe, RouterLink, HexlyDatePipe],
  host: { class: 'contents' },
  template: `
    <section
      class="group relative flex gap-4 p-4 pl-6 overflow-hidden h-full transition-shadow hover:shadow-3 has-[a:focus-visible]:[outline:2px_solid_var(--color-gold)] has-[a:focus-visible]:outline-offset-2"
      appPanel
      raised
    >
      <span class="absolute left-0 top-0 bottom-0 w-1.5 {{ bar() }}"></span>
      <span class="shrink-0 size-12 rounded-full flex items-center justify-center {{ sigil() }}">
        <app-icon [name]="typeIcon()" [size]="20" />
      </span>
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
              'entityBrowser.type.' + card().type | transloco
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
export class EntityCard {
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

  protected readonly bar = computed(() => ACCENT_BAR[accentFor(this.card().id)]);
  protected readonly sigil = computed(() => ACCENT_SIGIL[accentFor(this.card().id)]);
  /** The Entity type's registered icon (a hex map reads as terrain, a note as a label). */
  protected readonly typeIcon = computed<IconName>(() => this.types.resolve(this.card().type).icon);
  /** Rename is a substance edit; delete the lifecycle verb (ADR-0039). Absent Rights → hidden (fail-closed). */
  protected readonly canRename = computed(() => !!this.card().rights?.includes('edit'));
  protected readonly canDelete = computed(() => !!this.card().rights?.includes('delete'));
}
