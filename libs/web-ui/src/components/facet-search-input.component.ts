import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  applyFacetSuggestion,
  EntityFacets,
  FacetKeySet,
  FacetSuggestContext,
  facetKeySuggestions,
  facetSuggestAt,
  facetValueSuggestions,
  facetValuesFor,
  resolvesFacetKey,
} from '@hexly/domain';
import { TranslocoPipe } from '@jsverse/transloco';
import { ListboxController } from '../utils/listbox-controller';
import { InputComponent } from './input.component';
import { ListboxComponent } from './listbox.component';
import { ListboxOptionComponent } from './listbox-option.component';

/** Keys that move the caret without the list's help — after one, what it was completing may be stale. */
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

/** {@link ListboxComponent}'s own default width, for a box measured before it has been laid out. */
const FALLBACK_WIDTH = 256;

/** One offered row: what it reads as, what accepting it inserts, and — on a value — its live count. */
interface FacetSuggestion {
  readonly id: string;
  readonly label: string;
  readonly choice: string;
  readonly count?: number;
}

/**
 * The shared Entity search box (ADR-0082): the input, the two-stage **Facet Token** suggestion list, and
 * its keyboard, adopted by every surface that searches Entities.
 *
 * The two stages have two sources: keys come off {@link keys}, read synchronously from the client
 * registry, so `$` reveals the vocabulary whatever the network is doing; values come off {@link facets},
 * the read the surface already runs, so a suggestion costs no request. Naming no keys and passing no read
 * never opens the list — the box degrades to the plain one it replaces.
 *
 * Controlled: the consumer owns the text and receives every keystroke, an accepted suggestion included,
 * via {@link queryChange}. Grammar copy is this lib's (ADR-0049); surface copy (placeholder, aria-label)
 * is the consumer's; the look is `appInput`'s (ADR-0007). Lives in `web-ui`, not the Entity surfaces it
 * serves, so the Command Palette need not depend on a feature lib whose vocabulary it does not own (ADR-0032).
 */
@Component({
  selector: 'app-facet-search-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InputComponent, ListboxComponent, ListboxOptionComponent, TranslocoPipe],
  host: { class: 'block' },
  template: `
    <input
      #box
      appInput
      [attr.bar]="variant() === 'bar' ? '' : null"
      [attr.type]="type()"
      [attr.data-testid]="testid()"
      [attr.aria-label]="ariaLabel()"
      [attr.placeholder]="placeholder()"
      autocomplete="off"
      [attr.role]="expanded() ? 'combobox' : null"
      [attr.aria-expanded]="expanded() ? 'true' : null"
      [attr.aria-autocomplete]="expanded() ? 'list' : null"
      [attr.aria-controls]="visible() ? suggestionsListId() : controls()"
      [attr.aria-activedescendant]="visible() ? activeItemId() : activeDescendant()"
      [value]="value()"
      (input)="onInput($any($event.target).value)"
      (keydown)="onBoxKeyDown($event)"
      (click)="refresh()"
      (blur)="close()"
    />
    @if (visible()) {
      <app-listbox
        [testid]="testid() + '-suggestions'"
        [listboxId]="suggestionsListId()"
        [ariaLabel]="'ui.facetToken.suggestionsLabel' | transloco"
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
  /**
   * `text` for a consumer whose own Escape must survive: a search field clears itself on Escape in
   * Blink and WebKit, which would eat the key before the `<dialog>` it sits in could cancel.
   */
  readonly type = input<'search' | 'text'>('search');
  /** Which `appInput` the box wears: the sunken well a picker sits in, or the browse surfaces' bar. */
  readonly variant = input<'well' | 'bar'>('well');
  /** Copy naming this surface's content, already translated — the list's own label is this lib's. */
  readonly ariaLabel = input<string | null>(null);
  readonly placeholder = input<string | null>(null);
  /**
   * The consumer's own listbox where it has one — the Palette's results: its id, and the option it
   * highlights while the suggestions are shut, so one input serves two lists.
   */
  readonly controls = input<string | null>(null);
  readonly activeDescendant = input<string | null>(null);

  /** Every raw keystroke, undebounced — an accepted suggestion emits the rewritten box the same way. */
  readonly queryChange = output<string>();

  // read: ElementRef — `#box` also hosts `appInput`, so a bare query resolves to that component.
  private readonly box = viewChild.required('box', { read: ElementRef<HTMLInputElement> });
  /** The list hangs off the box and matches its width, measured when it opens. */
  protected readonly boxWidth = signal(FALLBACK_WIDTH);
  /** The token the open list is completing, so accepting one replaces exactly what was typed. */
  private context: FacetSuggestContext | null = null;
  /** A combobox while either list stands: this one's, or the consumer's, which outlives every close. */
  protected readonly expanded = computed(() => this.visible() || this.controls() !== null);
  /** The suggestion list's id, so `aria-controls` points at it — not the consumer's list — while open. */
  protected readonly suggestionsListId = computed(() => this.testid() + '-suggestions');

  /** Focus the box — the input is this component's, so a consumer that opens onto it asks for it here. */
  focus(): void {
    this.box().nativeElement.focus();
  }

  protected onInput(text: string): void {
    this.queryChange.emit(text);
    this.refresh();
  }

  /**
   * The list claims ↑↓/Enter/Escape while open, before ADR-0063's window dispatcher — the deviation
   * ADR-0082 records. Closed, it consumes nothing. Escape dismisses the suggestions only, its default
   * prevented so the `<dialog>` a picker sits in stays open.
   */
  protected onBoxKeyDown(event: KeyboardEvent): void {
    // Tab keeps its native focus move; the shared list would otherwise accept on it and trap focus.
    if (event.key === 'Tab') {
      this.close();
      return;
    }
    if (!this.onKeyDown(event)) {
      // A caret the list did not move leaves it looking at a token the caret may have left; shut it
      // rather than let the next Enter edit the wrong slice.
      if (CARET_KEYS.has(event.key)) this.close();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /** Accept the highlighted row. A completed key opens its value stage straight away; a completed value
   * leaves the list shut until the next keystroke. */
  protected override select(item: FacetSuggestion): void {
    const stage = this.context?.stage;
    super.select(item);
    if (stage === 'key') this.refresh();
  }

  /** Re-read the caret and offer what belongs there, or close where nothing does. */
  protected refresh(): void {
    const el = this.box().nativeElement;
    this.context = facetSuggestAt(el.value, el.selectionStart ?? el.value.length);
    const items = this.context ? this.suggestionsFor(this.context) : [];
    if (items.length === 0) {
      this.close();
      return;
    }
    this.boxWidth.set(el.getBoundingClientRect().width || FALLBACK_WIDTH);
    this.open({ items, command: (item) => this.accept(item), clientRect: () => el.getBoundingClientRect() });
  }

  private suggestionsFor(context: FacetSuggestContext): FacetSuggestion[] {
    if (context.stage === 'key')
      return facetKeySuggestions(this.keys(), context.prefix).map((key) => ({
        id: 'key-' + key,
        label: key,
        choice: key,
      }));
    // The value stage answers only for a key this surface can apply: the Facet read suggests values, and
    // is never allowed to widen the vocabulary the registry defines (ADR-0082).
    if (!resolvesFacetKey(this.keys(), context.key)) return [];
    return facetValueSuggestions(facetValuesFor(this.facets(), context.key), context.prefix).map((value) => ({
      id: 'value-' + value.value,
      // A Container is named on screen and addressed by id, as it is in the rail (ADR-0080).
      label: value.label ?? value.value,
      choice: value.value,
      count: value.count,
    }));
  }

  /** Write the accepted suggestion into the box and emit the keystroke typing it would have produced. */
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
