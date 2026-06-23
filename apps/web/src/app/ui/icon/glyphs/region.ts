import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconHost } from '../icon-host';

/**
 * The region glyph (a dashed boundary). One `<svg>` drawn in `currentColor`,
 * sized by `size`. Reached by name through `app-icon`, or directly. See
 * ADR-0007.
 */
@Component({
  selector: 'app-icon-region',
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
      <path d="M5 7c4-3 9-2 12 1s2 8-2 10-11 1-12-4 2-4 2-7z" />
    </svg>
  `,
})
export class RegionIcon {
  readonly size = input(24);
}
