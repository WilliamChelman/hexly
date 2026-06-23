import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { featureLibrary } from '@hexly/domain';

/** The single source of truth for the settlement marker art (ADR-0006/0007). */
const SETTLEMENT_PATH =
  featureLibrary.find((f) => f.id === 'settlement')?.path ?? '';

/**
 * The settlement feature glyph. One `<svg>` drawn in `currentColor`, sized by
 * `size`. Its path comes from `featureLibrary` so the inspector placeholder and
 * the canvas marker share ONE source of truth and cannot drift. Reached by name
 * through `app-icon`, or directly. See ADR-0007.
 */
@Component({
  selector: 'app-icon-settlement',
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
      <path [attr.d]="path" />
    </svg>
  `,
})
export class SettlementIcon {
  readonly size = input(24);
  protected readonly path = SETTLEMENT_PATH;
}
