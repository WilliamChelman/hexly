import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The settlement feature glyph. One `<svg>` drawn in `currentColor`, sized by
 * `size`. Reached by name through `app-icon`, or directly. See ADR-0007.
 */
@Component({
  selector: 'app-icon-settlement',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ':host { display: inline-flex; line-height: 0; }',
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
    >
      <path d="M5 19v-7l7-5 7 5v7z" />
      <path d="M10 19v-4h4v4" />
    </svg>
  `,
})
export class SettlementIcon {
  readonly size = input(24);
}
