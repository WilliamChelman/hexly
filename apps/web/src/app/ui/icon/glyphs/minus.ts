import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconHost } from '../icon-host';

/**
 * The minus glyph (zoom out). One `<svg>` drawn in `currentColor`, sized by
 * `size`. Reached by name through `app-icon`, or directly. See ADR-0007.
 */
@Component({
  selector: 'app-icon-minus',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [IconHost],
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
    >
      <path d="M6 12h12" />
    </svg>
  `,
})
export class MinusIcon {
  readonly size = input(24);
}
