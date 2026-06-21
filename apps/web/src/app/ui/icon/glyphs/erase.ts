import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The erase glyph (an eraser sweeping a baseline). One `<svg>` drawn in
 * `currentColor`, sized by `size`. Reached by name through `app-icon`, or
 * directly. See ADR-0007.
 */
@Component({
  selector: 'app-icon-erase',
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
      stroke-linecap="round"
    >
      <path d="M8 17l-3-3a1.8 1.8 0 0 1 0-2.6l6-6a1.8 1.8 0 0 1 2.6 0l3.4 3.4a1.8 1.8 0 0 1 0 2.6L13 17z" />
      <path d="M6 20h13" />
    </svg>
  `,
})
export class EraseIcon {
  readonly size = input(24);
}
