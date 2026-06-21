import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The terrain glyph (a hex tile). One `<svg>` drawn in `currentColor`, sized by
 * `size`. Reached by name through `app-icon`, or directly. See ADR-0007.
 */
@Component({
  selector: 'app-icon-terrain',
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
      <path d="M12 3l7 4.5v9L12 21l-7-4.5v-9z" />
    </svg>
  `,
})
export class TerrainIcon {
  readonly size = input(24);
}
