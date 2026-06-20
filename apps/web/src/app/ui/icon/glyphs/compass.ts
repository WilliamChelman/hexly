import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The compass glyph. One `<svg>` drawn in `currentColor`, sized by `size`.
 * Reached by name through `app-icon`, or directly. See ADR-0007.
 */
@Component({
  selector: 'app-icon-compass',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ':host { display: inline-flex; line-height: 0; }',
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.3"
    >
      <circle cx="12" cy="12" r="9" />
      <path
        d="m12 4 2 8 8 2-8 2-2 8-2-8-8-2 8-2z"
        fill="currentColor"
        stroke="none"
        opacity=".85"
      />
    </svg>
  `,
})
export class CompassIcon {
  readonly size = input(24);
}
