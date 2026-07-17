import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconHostDirective } from './icon-host.directive';

/**
 * Renders an arbitrary SVG path (`d`) as one `<svg>` glyph in `currentColor` — for
 * data-driven library icons such as a Feature's marker art (ADR-0007, ADR-0050).
 *
 * `stroke-linecap="round"` matches the canvas marker (map-renderer sets
 * `lineCap = 'round'`), so an open subpath looks identical in the palette and
 * on the map.
 */
@Component({
  selector: 'app-icon-path',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [IconHostDirective],
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
      <path [attr.d]="d()" />
    </svg>
  `,
})
export class IconPathComponent {
  readonly d = input.required<string>();
  readonly size = input(18);
}
