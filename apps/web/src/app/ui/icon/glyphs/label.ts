import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The label glyph (a serifed T). One `<svg>` drawn in `currentColor`, sized by
 * `size`. Reached by name through `app-icon`, or directly. See ADR-0007.
 */
@Component({
  selector: 'app-icon-label',
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
      <path d="M6 6h12M12 6v12M9.5 18h5" />
    </svg>
  `,
})
export class LabelIcon {
  readonly size = input(24);
}
