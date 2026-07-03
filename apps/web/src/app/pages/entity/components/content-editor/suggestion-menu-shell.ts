import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The positioned `<ul role="listbox">` box every suggestion picker shares — the `/`
 * slash menu, the `@` entity picker, the `::` descriptor picker and the `|`/`#` link-text
 * pickers (ADR-0019/0023/0033). Extracted when the third picker landed (the
 * DescriptorPicker `ponytail:` note asked for it): each picker projects only its own row
 * template, this owns the chrome (fixed position, size, border, aria wiring).
 */
@Component({
  selector: 'app-suggestion-menu-shell',
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
export class SuggestionMenuShell {
  readonly testid = input.required<string>();
  readonly ariaLabel = input.required<string | null>();
  readonly activeItemId = input.required<string | null>();
  readonly x = input.required<number>();
  readonly y = input.required<number>();
}
