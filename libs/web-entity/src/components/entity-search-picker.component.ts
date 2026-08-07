import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntitySummary } from '@hexly/domain';
import { EntitiesClient } from '@hexly/web-core';
import { ButtonComponent } from '@hexly/web-ui';
import { ContainerChipsComponent } from './container-chips.component';
import { FacetSearchInputComponent } from './facet-search-input.component';
import { PICKER_BOX_CLASS } from './picker-box-class';
import { pickerFacetTokens } from './picker-facet-tokens';
import { linkTargetFacets, linkTargetRead } from './link-target-read';

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
 * it **Mounts**, the World's own ranked first (ADR-0080) — for the surfaces that ADR names, which is
 * what {@link includeMounts} lets a consumer outside them say.
 *
 * The box is the shared {@link FacetSearchInputComponent} (ADR-0082), so the filters that were only ever
 * on the wire here are typeable: `$type:npc` narrows, key typeahead comes off the registry and value
 * typeahead off the Facet read the Container chips already issue. No rail on a picker, so the text is
 * the only store and backspacing a token reverses it.
 *
 * ponytail: no debounce — small owner lists, fine until list sizes force it.
 */
@Component({
  selector: 'app-entity-search-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, ContainerChipsComponent, FacetSearchInputComponent, TranslocoPipe],
  template: `
    <div class="rounded-md border border-line bg-surface p-1 shadow-2" [attr.data-testid]="testid() + '-menu'">
      <!-- The shared box (ADR-0082): a Facet Token filters from here, the whole vocabulary is offered on
           the dollar, and — no rail on a picker — a filter is reversed by backspacing its token. -->
      <app-facet-search-input
        class="mb-1"
        [testid]="testid() + '-search'"
        [inputClass]="boxClass"
        [value]="query()"
        [keys]="tokens.keys()"
        [facets]="facets()"
        [placeholder]="placeholderKey() | transloco"
        [listLabel]="'collab.entitySearchPicker.suggestionsLabel' | transloco"
        (queryChange)="queryChange.emit($event)"
      />
      <!-- A dollar-name nothing here answers to is *said*, never quietly searched for (ADR-0082). -->
      @if (tokens.parsed().unresolvedKeys.length > 0) {
        <p class="mb-1 px-1 text-xs text-ink-faint" role="status" [attr.data-testid]="testid() + '-unknown-facet'">
          {{
            'collab.entitySearchPicker.unknownFacet' | transloco: { keys: tokens.parsed().unresolvedKeys.join(', ') }
          }}
        </p>
      }
      <!-- The **Container** facet (ADR-0080), shared with the asset pickers: present only where this
           World Mounts something the read reached, so a picker that offers one Container's Entities shows
           no chip to narrow by. Counts come off the same read the options do, so a chip can never
           disagree with the list. -->
      <app-container-chips
        class="mb-1 block"
        [testid]="testid()"
        [containers]="containers()"
        [(selected)]="targets.container"
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
   * Scope the search to one World and the Containers it **Mounts** (ADR-0024, ADR-0080). Omitted →
   * the caller's whole owner scope, i.e. results may come from any of the Owner's Worlds — and, having
   * named no World, no Mount set to resolve either.
   */
  readonly worldId = input<string | undefined>(undefined);
  /** Constrain results to these Entity Types — e.g. an Entity-Link Field's target-type constraint. */
  readonly types = input<readonly string[] | undefined>(undefined);
  /**
   * Whether this picker may offer what the World **Mounts**. On by default, those being the surfaces
   * ADR-0080 widens — the `@` picker, the Entity Link Field picker, the Board Embed picker. A consumer
   * whose pick is stored as the World's own rather than as a link — the Dashboard's Pinned Entities —
   * declares itself out, and gets no Container chips either, there being one Container to narrow to.
   */
  readonly includeMounts = input(true);

  /** Every raw keystroke; the consumer commits it back to {@link query}. */
  readonly queryChange = output<string>();
  /** The Entity the user chose — the consumer decides what picking it means. */
  readonly pick = output<EntitySummary>();

  protected readonly options = signal<EntitySummary[]>([]);

  /** `appInput`'s well, as classes: the shared box owns its `<input>` and takes its chrome that way. */
  protected readonly boxClass = PICKER_BOX_CLASS;

  /**
   * What the box means (ADR-0082) — the filters its **Facet Tokens** name and the free text left over.
   * `$type` drops out of the vocabulary wherever {@link types} already pins it: the wire's `type` ORs,
   * so a token could only widen past the pin, and a stated miss beats a filter that quietly loosens one.
   */
  protected readonly tokens = pickerFacetTokens(
    () => this.query(),
    () => !this.types()?.length,
  );

  protected readonly targets = linkTargetRead(
    () => this.worldId(),
    () => {
      const types = this.types();
      return {
        // The residual text, not the raw box: the tokens have become params by here (ADR-0082).
        ...this.tokens.narrowing(),
        ...(types?.length ? { type: [...types] } : {}),
        // A picker is no browse: an Embed of an Asset and a pinned Asset stay pickable by name (ADR-0065).
        includeHidden: true,
      };
    },
    () => this.includeMounts(),
  );
  /** The one Facet read behind both the chips and the box's value typeahead — no request per keystroke. */
  protected readonly facets = linkTargetFacets(this.targets.params, () => this.includeMounts());
  /** The **Container** facet's live values — this World and the ones it Mounts that still hold a match. */
  protected readonly containers = computed(() => this.facets()?.container ?? []);

  constructor() {
    // Search server-side as the query changes (ADR-0025). onCleanup cancels a superseded
    // request; a failed search empties the list so the picker never breaks.
    effect((onCleanup) => {
      const sub = this.entitiesClient.list(this.targets.params()).subscribe({
        next: (page) => this.options.set(page.items),
        error: () => this.options.set([]),
      });
      onCleanup(() => sub.unsubscribe());
    });
  }
}
