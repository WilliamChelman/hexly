import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconHost } from '../icon-host';

/**
 * The select glyph (an arrow cursor). One `<svg>` drawn in `currentColor`, sized
 * by `size`. Reached by name through `app-icon`, or directly. See ADR-0007.
 */
@Component({
  selector: 'app-icon-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [IconHost],
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
      stroke-linecap="round"
    >
      <path d="M5 4l5 15 2.5-6 6-2.5z" />
    </svg>
  `,
})
export class SelectIcon {
  readonly size = input(24);
}
