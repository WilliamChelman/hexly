import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The overlay glyph (stacked waves). One `<svg>` drawn in `currentColor`, sized
 * by `size`. Reached by name through `app-icon`, or directly. See ADR-0007.
 */
@Component({
  selector: 'app-icon-overlay',
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
      stroke-linecap="round"
    >
      <path
        d="M3 8c3 0 3 3 6 3s3-3 6-3 3 3 6 3M3 15c3 0 3 3 6 3s3-3 6-3 3 3 6 3"
      />
    </svg>
  `,
})
export class OverlayIcon {
  readonly size = input(24);
}
