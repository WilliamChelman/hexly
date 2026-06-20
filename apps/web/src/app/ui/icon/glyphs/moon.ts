import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The moon glyph (dark-theme toggle). One `<svg>` drawn in `currentColor`, sized
 * by `size`. Reached by name through `app-icon`, or directly. See ADR-0007.
 */
@Component({
  selector: 'app-icon-moon',
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
        d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
      <circle cx="15.5" cy="7.5" r=".9" fill="currentColor" />
      <circle cx="18" cy="11" r=".6" fill="currentColor" />
    </svg>
  `,
})
export class MoonIcon {
  readonly size = input(24);
}
