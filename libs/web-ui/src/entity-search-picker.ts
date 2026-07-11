import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntitySummary } from '@hexly/domain';
import { EntitiesClient } from '@hexly/web-core';
import { Button } from './button';
import { Input } from './input';

/**
 * The shared server-side Entity picker (ADR-0025): a search box over the owner-scoped
 * `list({ q })` read, rendering matching Entities as pickable rows. Extracted from the
 * Inspector's Entity Link control so the World Dashboard's pin curation (#168) reuses
 * one search+pick surface. Presentation + search only — the consumer decides what a
 * pick *means* (link a Map element, pin an Entity) and owns the `query` (so it can reset
 * or reuse it, e.g. to name a create-and-link Entity). Projected content renders below
 * the option list, for consumer-specific actions like create-and-link.
 *
 * ponytail: no debounce — small owner lists, fine until list sizes force it (matches the
 * former inline picker).
 */
@Component({
  selector: 'app-entity-search-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Input, TranslocoPipe],
  template: `
    <div
      class="rounded-md border border-line bg-surface p-1 shadow-2"
      [attr.data-testid]="testid() + '-menu'"
    >
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
export class EntitySearchPicker {
  private readonly entitiesClient = inject(EntitiesClient);

  /** Prefix for the search box / option / menu `data-testid`s, per embedding surface. */
  readonly testid = input('entity-picker');
  /** Transloco key for the search input placeholder. */
  readonly placeholderKey = input('entitySearchPicker.searchPlaceholder');
  /** Transloco key shown when no Entity matches the query. */
  readonly emptyKey = input('entitySearchPicker.empty');
  /** The controlled query — the consumer owns it so it can reset or reuse it. */
  readonly query = input('');
  /**
   * Scope the search to one World (ADR-0024). Omitted → the caller's whole owner scope
   * (the Inspector's cross-map link picker). The Dashboard passes the active World so a
   * pin can only be a same-World Entity, never one from another of the Owner's Worlds.
   */
  readonly worldId = input<string | undefined>(undefined);

  /** Every raw keystroke; the consumer commits it back to {@link query}. */
  readonly queryChange = output<string>();
  /** The Entity the user chose — the consumer decides what picking it means. */
  readonly pick = output<EntitySummary>();

  protected readonly options = signal<EntitySummary[]>([]);

  constructor() {
    // Search server-side as the query changes (ADR-0025). onCleanup cancels a superseded
    // request; a failed search empties the list so the picker never breaks.
    effect((onCleanup) => {
      const sub = this.entitiesClient
        .list({ q: this.query().trim(), worldId: this.worldId() })
        .subscribe({
          next: (page) => this.options.set(page.items),
          error: () => this.options.set([]),
        });
      onCleanup(() => sub.unsubscribe());
    });
  }
}
