import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The share glyph. One `<svg>` drawn in `currentColor`, sized by `size`. Reached
 * by name through `app-icon`, or directly. See ADR-0007.
 */
@Component({
  selector: 'app-icon-share',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex leading-[0]' },
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="6" cy="12" r="2.4" />
      <circle cx="18" cy="6" r="2.4" />
      <circle cx="18" cy="18" r="2.4" />
      <path d="m8.1 10.8 7.8-3.6M8.1 13.2l7.8 3.6" />
    </svg>
  `,
})
export class ShareIcon {
  readonly size = input(24);
}
