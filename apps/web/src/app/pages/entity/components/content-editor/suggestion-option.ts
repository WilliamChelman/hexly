import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  effect,
  inject,
  input,
  output,
} from '@angular/core';

/**
 * One selectable row in a suggestion picker — the `<li><button role="option">` every
 * picker repeats (slash / entity / descriptor / display / heading). Attribute selector on
 * the `<li>` itself so the `<ul>` (in {@link SuggestionMenuShell}) keeps a valid, a11y-clean
 * `ul > li` structure; the button and its projected label live in the template. `mousedown`
 * is swallowed so the click doesn't first blur the editor (losing the selection the pick
 * acts on); the caller wires `(pick)` to its own `select(item)`.
 */
@Component({
  selector: 'li[appSuggestionOption]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'presentation' },
  template: `
    <button
      type="button"
      role="option"
      [id]="optionId()"
      [attr.data-testid]="testid()"
      [attr.aria-selected]="selected()"
      class="block w-full cursor-pointer px-3 py-1 text-left text-sm text-ink"
      [class.bg-surface-sunken]="selected()"
      (mousedown)="$event.preventDefault()"
      (click)="pick.emit()"
    >
      <ng-content />
    </button>
  `,
})
export class SuggestionOption {
  readonly optionId = input.required<string>();
  readonly testid = input.required<string>();
  readonly selected = input.required<boolean>();
  readonly pick = output<void>();

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // Keyboard nav (ArrowUp/Down) only moves activeIndex; keep the highlighted row visible
    // inside the overflow-auto list. `nearest` scrolls the minimum, so a click never jumps.
    effect(() => {
      if (this.selected()) this.el.nativeElement.scrollIntoView?.({ block: 'nearest' });
    });
  }
}

/** The muted `<li>` a picker shows when a query matches nothing — the `@empty` row's styling, once. */
@Directive({
  selector: 'li[appSuggestionEmpty]',
  host: { class: 'px-3 py-1 text-sm text-ink-muted' },
})
export class SuggestionEmpty {}
