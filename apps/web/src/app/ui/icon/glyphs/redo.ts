import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The redo glyph (a curved arrow looping forward to the right) — the mirror of
 * {@link UndoIcon}. One `<svg>` drawn in `currentColor`, sized by `size`.
 * Imported directly by the consumer that shows it (there is no `app-icon`
 * dispatcher). See ADR-0007.
 */
@Component({
  selector: 'app-icon-redo',
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
      <path d="M15 7H9a5 5 0 0 0 0 10h7" />
      <path d="M15 3l4 4-4 4" />
    </svg>
  `,
})
export class RedoIcon {
  readonly size = input(24);
}
