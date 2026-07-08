import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The positioned `<ul role="listbox">` box a picker projects its rows into: it owns the
 * chrome (fixed position, size, border, aria wiring) so each caller supplies only its own
 * `<li>` option template. Pairs with {@link ListboxController} for keyboard behaviour.
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
      class="fixed z-50 max-h-72 w-64 overflow-auto rounded-md border border-line bg-surface py-1 shadow-2"
      [style.left.px]="x()"
      [style.top.px]="y()"
    >
      <ng-content />
    </ul>
  `,
})
export class Listbox {
  readonly testid = input.required<string>();
  readonly ariaLabel = input.required<string | null>();
  readonly activeItemId = input.required<string | null>();
  readonly x = input.required<number>();
  readonly y = input.required<number>();
}
