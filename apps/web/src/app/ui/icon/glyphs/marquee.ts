import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconHost } from '../icon-host';

/**
 * The marquee glyph (a dashed selection rectangle). One `<svg>` drawn in
 * `currentColor`, sized by `size`. Reached by name through `app-icon`, or
 * directly. See ADR-0007.
 */
@Component({
  selector: 'app-icon-marquee',
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
      stroke-dasharray="3 2.5"
    >
      <rect x="4" y="4" width="16" height="16" rx="1" />
    </svg>
  `,
})
export class MarqueeIcon {
  readonly size = input(24);
}
