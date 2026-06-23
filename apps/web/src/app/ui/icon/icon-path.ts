import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconHost } from './icon-host';

/**
 * Renders an arbitrary SVG path (`d`) as one `<svg>` glyph in `currentColor`,
 * sized by `size`. Used to draw data-driven library icons (e.g. a Feature's
 * `path` from `featureLibrary`) without inlining raw `<svg>` into feature
 * templates — see ADR-0007 ("SVG glyphs live in their own components").
 *
 * `stroke-linecap="round"` matches the canvas marker (map-renderer sets
 * `lineCap = 'round'`), so an open subpath looks identical in the palette and
 * on the map.
 */
@Component({
  selector: 'app-icon-path',
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
      <path [attr.d]="d()" />
    </svg>
  `,
})
export class IconPath {
  readonly d = input.required<string>();
  readonly size = input(18);
}
