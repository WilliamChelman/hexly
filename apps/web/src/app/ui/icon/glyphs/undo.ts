import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The undo glyph (a curved arrow looping back to the left). One `<svg>` drawn in
 * `currentColor`, sized by `size`. Imported directly by the consumer that shows
 * it (there is no `app-icon` dispatcher). See ADR-0007.
 */
@Component({
  selector: 'app-icon-undo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex leading-[0]' },
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
      <path d="M9 7H15a5 5 0 0 1 0 10H8" />
      <path d="M9 3 5 7l4 4" />
    </svg>
  `,
})
export class UndoIcon {
  readonly size = input(24);
}
