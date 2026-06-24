import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconHost } from '../icon-host';

/**
 * The fit glyph (frame corners). One `<svg>` drawn in `currentColor`, sized by
 * `size`. Reached by name through `app-icon`, or directly. See ADR-0007.
 */
@Component({
  selector: 'app-icon-fit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [IconHost],
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M5 9V5h4M19 9V5h-4M5 15v4h4M19 15v4h-4" />
    </svg>
  `,
})
export class FitIcon {
  readonly size = input(24);
}
