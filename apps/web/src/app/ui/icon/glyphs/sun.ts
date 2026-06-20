import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The sun glyph (light-theme toggle). One `<svg>` drawn in `currentColor`, sized
 * by `size`. Reached by name through `app-icon`, or directly. See ADR-0007.
 */
@Component({
  selector: 'app-icon-sun',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ':host { display: inline-flex; line-height: 0; }',
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path
        d="M12 2.5v2M12 19.5v2M4.5 12h-2M21.5 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4"
      />
    </svg>
  `,
})
export class SunIcon {
  readonly size = input(24);
}
