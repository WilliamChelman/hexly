import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  input,
} from '@angular/core';

/**
 * The reusable page-owned header frame (ADR-0022). It owns the shared chrome —
 * height, baseline, border, gilded surface — and exposes three projection slots
 * so every page renders its own content into a consistent bar without drifting
 * into a divergent per-feature header. Plain pages project an eyebrow + title and
 * page actions; the rich editor projects its contenteditable title + status chip
 * and Save/Share into the very same slots.
 *
 *   <app-page-header>
 *     <span pageHeaderTitle>…</span>
 *     <button pageHeaderActions>…</button>
 *   </app-page-header>
 *
 * A page that needs a fully bespoke bar simply doesn't use this.
 */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'flex items-center gap-4 px-4 h-[var(--rail-header)] bg-linear-[180deg] from-surface to-bg-deep border-b border-b-line shadow-2',
    role: 'banner',
    '[class.sticky]': 'sticky()',
    '[class.top-0]': 'sticky()',
    '[class.z-30]': 'sticky()',
  },
  template: `
    <!-- empty:hidden so an unused leading slot reserves no phantom gap before the title. -->
    <div class="flex items-center shrink-0 empty:hidden" data-testid="slot-leading">
      <ng-content select="[pageHeaderLeading]" />
    </div>
    <div class="flex items-center gap-3 min-w-0 flex-1" data-testid="slot-title">
      <ng-content select="[pageHeaderTitle]" />
    </div>
    <div class="flex items-center gap-2 ml-auto shrink-0" data-testid="slot-actions">
      <ng-content select="[pageHeaderActions]" />
    </div>
  `,
})
export class PageHeader {
  /**
   * Stick the header to the top of the page's scroll region so actions (Save,
   * conflict Reload) stay reachable on a long page. Off by default; the editor
   * leaves it off and pins the header via its own grid instead.
   */
  readonly sticky = input(false, { transform: booleanAttribute });
}
