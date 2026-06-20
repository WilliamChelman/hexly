import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The Hexly logo glyph. One `<svg>` drawn in `currentColor`, sized by `size`.
 * Reached by name through `app-icon`, or directly via its selector. See
 * ADR-0007.
 */
@Component({
  selector: 'app-icon-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ':host { display: inline-flex; line-height: 0; }',
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M12 2.2 20.5 7v10L12 21.8 3.5 17V7z"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
      <path
        d="M12 7.4 16.2 9.9v4.2L12 16.6 7.8 14.1V9.9z"
        fill="currentColor"
        opacity=".5"
      />
    </svg>
  `,
})
export class LogoIcon {
  readonly size = input(24);
}
