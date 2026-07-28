import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntitySummary } from '@hexly/domain';
import { EntitiesClient } from '@hexly/web-core';
import { ButtonComponent, InputComponent } from '@hexly/web-ui';

/**
 * The shared server-side Entity picker (ADR-0025): a search box over the `list({ q })` read,
 * rendering matching Entities as pickable rows. Presentation + search only — the consumer decides
 * what a pick *means* (link a Map element, pin an Entity), owns the `query`, and names the
 * {@link worldId} to search within. Projected content renders below the option list, for
 * consumer-specific actions like create-and-link.
 *
 * ponytail: no debounce — small owner lists, fine until list sizes force it.
 */
@Component({
  selector: 'app-entity-search-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, InputComponent, TranslocoPipe],
  template: `
    <div class="rounded-md border border-line bg-surface p-1 shadow-2" [attr.data-testid]="testid() + '-menu'">
      <input
        appInput
        class="mb-1"
        [attr.data-testid]="testid() + '-search'"
        [attr.placeholder]="placeholderKey() | transloco"
        [value]="query()"
        (input)="queryChange.emit($any($event.target).value)"
      />
      <!-- Only the option list scrolls; a projected footer (create rows) stays pinned. -->
      <div class="max-h-56 overflow-auto">
        @for (e of options(); track e.id) {
          <button
            type="button"
            appButton
            variant="ghost"
            size="sm"
            class="w-full justify-start!"
            [attr.data-testid]="testid() + '-option-' + e.id"
            (click)="pick.emit(e)"
          >
            {{ e.name }}
            <span class="font-mono text-2xs text-ink-muted">({{ e.types[0] }})</span>
          </button>
        } @empty {
          <p class="px-2 py-1 text-sm text-ink-muted">
            {{ emptyKey() | transloco }}
          </p>
        }
      </div>
      <ng-content />
    </div>
  `,
})
export class EntitySearchPickerComponent {
  private readonly entitiesClient = inject(EntitiesClient);

  /** Prefix for the search box / option / menu `data-testid`s, per embedding surface. */
  readonly testid = input('entity-picker');
  /** Transloco key for the search input placeholder. */
  readonly placeholderKey = input('collab.entitySearchPicker.searchPlaceholder');
  /** Transloco key shown when no Entity matches the query. */
  readonly emptyKey = input('collab.entitySearchPicker.empty');
  /** The controlled query — the consumer owns it so it can reset or reuse it. */
  readonly query = input('');
  /**
   * Scope the search to one World (ADR-0024). Omitted → the caller's whole owner scope, i.e.
   * results may come from any of the Owner's Worlds.
   */
  readonly worldId = input<string | undefined>(undefined);
  /** Constrain results to these Entity Types — e.g. an Entity-Link Field's target-type constraint. */
  readonly types = input<readonly string[] | undefined>(undefined);

  /** Every raw keystroke; the consumer commits it back to {@link query}. */
  readonly queryChange = output<string>();
  /** The Entity the user chose — the consumer decides what picking it means. */
  readonly pick = output<EntitySummary>();

  protected readonly options = signal<EntitySummary[]>([]);

  constructor() {
    // Search server-side as the query changes (ADR-0025). onCleanup cancels a superseded
    // request; a failed search empties the list so the picker never breaks.
    effect((onCleanup) => {
      const types = this.types();
      const sub = this.entitiesClient
        .list({
          q: this.query().trim(),
          worldId: this.worldId(),
          type: types?.length ? [...types] : undefined,
          // A picker is no browse: an Embed of an Asset and a pinned Asset stay pickable by name (ADR-0065).
          includeHidden: true,
        })
        .subscribe({
          next: (page) => this.options.set(page.items),
          error: () => this.options.set([]),
        });
      onCleanup(() => sub.unsubscribe());
    });
  }
}
