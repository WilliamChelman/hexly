import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ListboxAnchor, placeListbox } from '../utils/listbox-placement';

/**
 * The positioned `<ul role="listbox">` box a picker projects its `<li>` rows into; owns the
 * chrome (fixed position, size, border, aria wiring). Pairs with {@link ListboxController}
 * for keyboard behaviour, and with {@link placeListbox} to stay inside the viewport — a caret
 * near the bottom of the page flips the box above rather than letting it run off-screen.
 */
@Component({
  selector: 'app-listbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul
      role="listbox"
      [attr.data-testid]="testid()"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-activedescendant]="activeItemId()"
      class="fixed z-50 overflow-auto rounded-md border border-line bg-surface py-1 shadow-2"
      [style.width.px]="width()"
      [style.left.px]="placement().left"
      [style.top.px]="placement().top"
      [style.bottom.px]="placement().bottom"
      [style.maxHeight.px]="placement().maxHeight"
    >
      <ng-content />
    </ul>
  `,
})
export class ListboxComponent {
  readonly testid = input.required<string>();
  readonly ariaLabel = input.required<string | null>();
  readonly activeItemId = input.required<string | null>();
  /** The caret or field the box hangs off, in viewport coordinates. */
  readonly anchor = input.required<ListboxAnchor>();
  readonly width = input(256);

  protected readonly placement = computed(() =>
    placeListbox(this.anchor(), this.width(), { width: window.innerWidth, height: window.innerHeight }),
  );
}
