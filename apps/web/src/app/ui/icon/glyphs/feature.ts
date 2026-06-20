import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The generic feature glyph (a four-point star). One `<svg>` drawn in
 * `currentColor`, sized by `size`. Reached by name through `app-icon`, or
 * directly. See ADR-0007.
 */
@Component({
  selector: 'app-icon-feature',
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
      <path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z" />
    </svg>
  `,
})
export class FeatureIcon {
  readonly size = input(24);
}
