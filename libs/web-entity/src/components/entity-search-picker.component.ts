import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntitySummary, FacetCount } from '@hexly/domain';
import { EntitiesClient } from '@hexly/web-core';
import { ButtonComponent, InputComponent } from '@hexly/web-ui';

/**
 * The shared server-side Entity picker (ADR-0025): a search box over the `list({ q })` read,
 * rendering matching Entities as pickable rows. Presentation + search only — the consumer decides
 * what a pick *means* (link a Map element, pin an Entity), owns the `query`, and names the
 * {@link worldId} to search within. Projected content renders below the option list, for
 * consumer-specific actions like create-and-link.
 *
 * Every consumer asks the same question — *what may this point at?* — so the read is a **link-target
 * read** here rather than once per consumer (ADR-0079), which covers the **Entity Link** Field picker,
 * the Board **Embed** picker and a broken link's relink popover together. Naming a {@link worldId} is
 * what widens it, too: the server answers with that World's Entities *and* the ones in the Containers
 * it **Mounts**, the World's own ranked first (ADR-0080).
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
      <!-- The **Container** facet (ADR-0080): present only where this World Mounts something the read
           reached, so a picker that offers one Container's Entities shows no chip to narrow by. Counts
           come off the same read the options do, so a chip can never disagree with the list. -->
      @if (containers().length > 1) {
        <div class="mb-1 flex flex-wrap gap-1" [attr.data-testid]="testid() + '-containers'">
          <button
            type="button"
            appButton
            [variant]="container() ? 'ghost' : 'default'"
            size="sm"
            [attr.data-testid]="testid() + '-container-all'"
            (click)="container.set(undefined)"
          >
            {{ 'collab.entitySearchPicker.allContainers' | transloco }}
          </button>
          @for (c of containers(); track c.value) {
            <button
              type="button"
              appButton
              [variant]="container() === c.value ? 'default' : 'ghost'"
              size="sm"
              [attr.data-testid]="testid() + '-container-' + c.value"
              (click)="container.set(c.value)"
            >
              {{ c.label ?? c.value }}
              <span class="font-mono text-2xs text-ink-muted">({{ c.count }})</span>
            </button>
          }
        </div>
      }
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
   * Scope the search to one World and the Containers it **Mounts** (ADR-0024, ADR-0080). Omitted →
   * the caller's whole owner scope, i.e. results may come from any of the Owner's Worlds — and, having
   * named no World, no Mount set to resolve either.
   */
  readonly worldId = input<string | undefined>(undefined);
  /** Constrain results to these Entity Types — e.g. an Entity-Link Field's target-type constraint. */
  readonly types = input<readonly string[] | undefined>(undefined);

  /** Every raw keystroke; the consumer commits it back to {@link query}. */
  readonly queryChange = output<string>();
  /** The Entity the user chose — the consumer decides what picking it means. */
  readonly pick = output<EntitySummary>();

  protected readonly options = signal<EntitySummary[]>([]);
  /** The **Container** facet's live values — this World and the ones it Mounts that still hold a match. */
  protected readonly containers = signal<readonly FacetCount[]>([]);
  /** The Container the user narrowed to, if any — one pack, or one Shelf (ADR-0080). */
  protected readonly container = signal<string | undefined>(undefined);

  constructor() {
    // A narrowing the query outlives would silently answer the next search from a Container the user
    // cannot see chosen: a new World is a new set of Containers, so the selection goes with it.
    effect(() => {
      this.worldId();
      untracked(() => this.container.set(undefined));
    });
    // Search server-side as the query changes (ADR-0025). onCleanup cancels a superseded
    // request; a failed search empties the list so the picker never breaks.
    effect((onCleanup) => {
      const sub = this.entitiesClient.list(this.read()).subscribe({
        next: (page) => this.options.set(page.items),
        error: () => this.options.set([]),
      });
      onCleanup(() => sub.unsubscribe());
    });
    // The facet counts, off the same read the options come from — its own selection dropped, as every
    // drill-down facet's is, so the chip you are standing on keeps its siblings to move to.
    effect((onCleanup) => {
      const sub = this.entitiesClient.facets({ ...this.read(), container: undefined }).subscribe({
        next: (facets) => this.containers.set(facets.container ?? []),
        error: () => this.containers.set([]),
      });
      onCleanup(() => sub.unsubscribe());
    });
  }

  /** The one read behind both the options and the chips annotating them, so the two cannot disagree. */
  private read() {
    const types = this.types();
    const container = this.container();
    return {
      q: this.query().trim(),
      worldId: this.worldId(),
      type: types?.length ? [...types] : undefined,
      container: container ? [container] : undefined,
      read: 'link-target' as const,
      // A picker is no browse: an Embed of an Asset and a pinned Asset stay pickable by name (ADR-0065).
      includeHidden: true,
    };
  }
}
