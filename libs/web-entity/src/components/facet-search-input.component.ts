import { ChangeDetectionStrategy, Component, ElementRef, input, output, signal, viewChild } from '@angular/core';
import {
  applyFacetSuggestion,
  EntityFacets,
  FacetKeySet,
  FacetSuggestContext,
  facetKeySuggestions,
  facetSuggestAt,
  facetValueSuggestions,
  facetValuesFor,
} from '@hexly/domain';
import { ListboxComponent, ListboxController, ListboxOptionComponent } from '@hexly/web-ui';

/** One offered row: what it reads as, what accepting it inserts, and — on a value — its live count. */
interface FacetSuggestion {
  readonly id: string;
  readonly label: string;
  readonly choice: string;
  readonly count?: number;
}

/**
 * The shared Entity search box (ADR-0082): the input, the two-stage **Facet Token** suggestion list,
 * and the keyboard that drives it — built once here, and adopted by every surface that searches
 * Entities, so the behaviour is not re-implemented six times.
 *
 * **Stage one, keys**, comes off {@link keys} — the surface's vocabulary, read synchronously from its
 * client registry — so pressing `$` reveals the entire filter vocabulary in one list whatever the
 * network is doing. **Stage two, values**, comes off {@link facets}: the Facet read the surface
 * *already* runs, so a value suggestion costs no request and carries the count the rail shows. A
 * surface that names no keys and passes no read simply never opens the list, which is how the box
 * degrades to the plain one it replaces.
 *
 * Controlled, like the box it replaces: the consumer owns the text (its own debounce, its own URL
 * mirror) and receives every keystroke — including the one an accepted suggestion writes — through
 * {@link queryChange}. Chrome (classes, placeholder, labels) is the consumer's, already translated,
 * so this stays free of any one surface's copy and of a translation scope.
 */
@Component({
  selector: 'app-facet-search-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ListboxComponent, ListboxOptionComponent],
  host: { class: 'block' },
  template: `
    <input
      #box
      type="search"
      [class]="inputClass()"
      [attr.data-testid]="testid()"
      [attr.aria-label]="ariaLabel()"
      [attr.placeholder]="placeholder()"
      autocomplete="off"
      [attr.role]="visible() ? 'combobox' : null"
      [attr.aria-expanded]="visible() ? 'true' : null"
      [attr.aria-activedescendant]="activeItemId()"
      [value]="value()"
      (input)="onInput($any($event.target).value)"
      (keydown)="onBoxKeyDown($event)"
      (blur)="close()"
    />
    @if (visible()) {
      <app-listbox
        [testid]="testid() + '-suggestions'"
        [ariaLabel]="listLabel()"
        [activeItemId]="activeItemId()"
        [anchor]="anchor()!"
        [width]="boxWidth()"
      >
        @for (item of items(); track item.id; let i = $index) {
          <li
            appListboxOption
            [optionId]="optionId(item.id)"
            [testid]="testid() + '-suggestion-' + item.choice"
            [selected]="i === activeIndex()"
            (pick)="select(item)"
          >
            <span class="font-mono text-xs">{{ item.label }}</span>
            @if (item.count !== undefined) {
              <span class="ml-2 text-ink-faint tabular-nums">{{ item.count }}</span>
            }
          </li>
        }
      </app-listbox>
    }
  `,
})
export class FacetSearchInputComponent extends ListboxController<FacetSuggestion> {
  protected readonly optionIdPrefix = 'facet-suggestion-';

  /** The controlled text — the consumer's source of truth, debounced and mirrored as it sees fit. */
  readonly value = input('');
  /**
   * This surface's Facet vocabulary, read synchronously from the client registry (ADR-0082) — never
   * from the Facet read. Empty by default: a surface that names none offers no keys and no values.
   */
  readonly keys = input<FacetKeySet>({ reserved: [], fields: [] });
  /**
   * The Facet read the surface already runs, for value suggestions and their counts alone. Absent —
   * the Palette, which runs none — leaves the key stage intact and the value stage silent.
   */
  readonly facets = input<EntityFacets | null>(null);

  readonly testid = input('facet-search');
  /** Chrome the consumer owns, already translated: the input's classes and its accessible copy. */
  readonly inputClass = input('');
  readonly ariaLabel = input<string | null>(null);
  readonly placeholder = input<string | null>(null);
  readonly listLabel = input<string | null>(null);

  /** Every raw keystroke, undebounced — an accepted suggestion emits the rewritten box the same way. */
  readonly queryChange = output<string>();

  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');
  /** The list hangs off the box and matches its width, measured when it opens. */
  protected readonly boxWidth = signal(256);
  /** The token the open list is completing, so accepting one replaces exactly what was typed. */
  private context: FacetSuggestContext | null = null;

  protected onInput(text: string): void {
    this.queryChange.emit(text);
    this.refresh();
  }

  /**
   * The list claims ↑↓/Enter/Escape **while it is open**, through this element-level handler, stopping
   * them before ADR-0063's window dispatcher — the deliberate deviation ADR-0082 records. Closed, it
   * consumes nothing and every key behaves as it did before the box gained a list. Escape dismisses the
   * suggestions only: the default is prevented so the `<dialog>` a picker sits in stays open.
   */
  protected onBoxKeyDown(event: KeyboardEvent): void {
    // Tab keeps its native focus move; the shared list would otherwise accept on it and trap focus.
    if (event.key === 'Tab') {
      this.close();
      return;
    }
    if (!this.onKeyDown(event)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  /** Accept the highlighted row. A key just completed opens its value stage straight away; a completed
   * value asked its whole question, so the list stays shut until the next keystroke. */
  protected override select(item: FacetSuggestion): void {
    const stage = this.context?.stage;
    super.select(item);
    if (stage === 'key') this.refresh();
  }

  /** Re-read the caret and offer what belongs there, or close where nothing does. */
  private refresh(): void {
    const el = this.box().nativeElement;
    this.context = facetSuggestAt(el.value, el.selectionStart ?? el.value.length);
    const items = this.context ? this.suggestionsFor(this.context) : [];
    if (items.length === 0) {
      this.close();
      return;
    }
    this.boxWidth.set(el.getBoundingClientRect().width || 256);
    this.open({ items, command: (item) => this.accept(item), clientRect: () => el.getBoundingClientRect() });
  }

  private suggestionsFor(context: FacetSuggestContext): FacetSuggestion[] {
    if (context.stage === 'key')
      return facetKeySuggestions(this.keys(), context.prefix).map((key) => ({
        id: 'key-' + key,
        label: key,
        choice: key,
      }));
    return facetValueSuggestions(facetValuesFor(this.facets(), context.key ?? ''), context.prefix).map((value) => ({
      id: 'value-' + value.value,
      // A Container is named on screen and addressed by id, as it is in the rail (ADR-0080).
      label: value.label ?? value.value,
      choice: value.value,
      count: value.count,
    }));
  }

  /**
   * Write the accepted suggestion into the box and hand the consumer the same keystroke typing it would
   * have produced. The **stored value goes in verbatim** — case, spacing, and the quotes the grammar
   * needs — because the parser does not case-fold, and a folded insert would disagree with the rail.
   */
  private accept(item: FacetSuggestion): void {
    const el = this.box().nativeElement;
    if (!this.context) return;
    const { text, caret } = applyFacetSuggestion(el.value, this.context, item.choice);
    el.value = text;
    el.setSelectionRange(caret, caret);
    el.focus();
    this.queryChange.emit(text);
  }
}
