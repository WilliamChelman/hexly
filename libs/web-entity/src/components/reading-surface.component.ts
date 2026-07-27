import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The scroll shell shared by the `layout: 'reading'` Views (Content, Details; ADR-0067): a full-bleed
 * container carrying the sunken background with a centred column for the projected View body. A shared
 * component, not page chrome, because it is View main content — so it travels with a Board Embed, unlike
 * the page-owned Dock.
 *
 * Its scrollbar recedes until hover so it never competes with the floating Dock, and it clears the Dock by
 * right-padding from the page-owned `--_reading-dock-inset` (inherited in) rather than moving, so the bar
 * stays at the true viewport edge. `class: contents` so the `absolute inset-0` surface positions against
 * the page's `<main>`; `data-content-scroll` is the Outline's scroll root. That pair is `--_…` because a
 * container-query result is a private indirection var, not a design token (ADR-0075).
 */
@Component({
  selector: 'app-reading-surface',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  styles: `
    .reading-scroll {
      scrollbar-gutter: stable;
      scrollbar-color: transparent transparent;
      padding-right: var(--_reading-dock-inset, 0rem);
      /* The page zeroes the duration while the Panel is being dragged, so the column tracks the grip. */
      transition: padding-right var(--_reading-dock-transition, 200ms);
    }
    .reading-scroll:hover {
      scrollbar-color: var(--color-line-strong) transparent;
    }
    .reading-scroll::-webkit-scrollbar-thumb {
      background: transparent;
    }
    .reading-scroll:hover::-webkit-scrollbar-thumb {
      background: var(--color-line-strong);
      background-clip: padding-box;
    }
  `,
  template: `
    <div data-content-scroll class="reading-scroll absolute inset-0 overflow-y-auto bg-surface-sunken">
      <div class="mx-auto max-w-[60rem] px-6 py-6">
        <ng-content />
      </div>
    </div>
  `,
})
export class ReadingSurfaceComponent {}
