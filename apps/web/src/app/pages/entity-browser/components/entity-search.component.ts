import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntityFacets, FacetKeySet } from '@hexly/domain';
import { FacetSearchInputComponent, IconComponent } from '@hexly/web-ui';

/**
 * The browse surfaces' full-text search box (#154) — the Entity Browser's, the Library's, the Asset
 * Browser's. Controlled: the parent owns the query (debounce, URL mirror), passing it in as
 * {@link value} and receiving every raw keystroke via {@link queryChange}. No debounce here.
 *
 * The box itself is the shared {@link FacetSearchInputComponent} (ADR-0082), which owns the **Facet
 * Token** suggestion list and its keyboard; this holds only what is this family's own — the leading
 * glyph, the copy, the chrome. A surface that names no {@link keys} gets exactly the plain box it had.
 */
@Component({
  selector: 'app-entity-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, TranslocoPipe, FacetSearchInputComponent],
  host: { class: 'relative block mb-8' },
  template: `
    <app-icon
      name="label"
      [size]="18"
      class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
    />
    <app-facet-search-input
      testid="entity-search"
      variant="bar"
      [value]="value()"
      [keys]="keys()"
      [facets]="facets()"
      [ariaLabel]="'entityBrowser.searchLabel' | transloco"
      [placeholder]="'entityBrowser.searchPlaceholder' | transloco"
      [listLabel]="'entityBrowser.suggestionsLabel' | transloco"
      (queryChange)="queryChange.emit($event)"
    />
  `,
})
export class EntitySearchComponent {
  /** The active query to display (the parent's debounced, URL-mirrored source of truth). */
  readonly value = input('');
  /** This surface's Facet vocabulary, read synchronously from its client registry (ADR-0082). */
  readonly keys = input<FacetKeySet>({ reserved: [], fields: [] });
  /** The Facet read this surface already runs — value suggestions and their counts, nothing more. */
  readonly facets = input<EntityFacets | null>(null);
  /** Every raw keystroke, undebounced — the parent debounces and commits it. */
  readonly queryChange = output<string>();
}
