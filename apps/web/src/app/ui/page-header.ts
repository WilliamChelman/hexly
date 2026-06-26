import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  input,
} from '@angular/core';

/**
 *   <app-page-header>
 *     <span pageHeaderTitle>…</span>
 *     <button pageHeaderActions>…</button>
 *   </app-page-header>
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
  readonly sticky = input(false, { transform: booleanAttribute });
}
