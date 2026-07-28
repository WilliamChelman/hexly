import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Region } from '@hexly/plugin-hexmap';
import { ButtonComponent, EyebrowComponent, SwatchComponent } from '@hexly/web-ui';
import { HexMapStore } from '../services/hexmap-store';

/**
 * Regions panel sharing the Inspector's column (ADR-0011).
 * Lists every Region, including ones with no member hexes.
 */
@Component({
  selector: 'app-regions-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex flex-col gap-2 p-4 overflow-y-auto bg-surface',
  },
  imports: [ButtonComponent, EyebrowComponent, SwatchComponent, TranslocoPipe],
  template: `
    <header class="flex items-center justify-between gap-3">
      <span appEyebrow mark>{{ 'map.regionsPanel.title' | transloco }}</span>
      <button type="button" appButton variant="ghost" size="sm" data-testid="new-region" (click)="store.newRegion()">
        {{ 'map.regionsPanel.newRegion' | transloco }}
      </button>
    </header>

    @for (region of store.regions(); track region.id) {
      <button
        type="button"
        class="flex items-center gap-3 w-full py-2 px-3 text-sm text-ink bg-transparent border border-transparent rounded-md cursor-pointer text-left hover:bg-accent-soft aria-[current=true]:bg-accent-soft aria-[current=true]:border-accent aria-[current=true]:text-ink-strong"
        data-testid="region-item"
        [attr.aria-current]="isRegionSelected(region.id) ? 'true' : null"
        (click)="store.selectRegion(region.id)"
      >
        <span appSwatch [style.background]="region.color" [style.color]="region.color"></span>
        <span class="flex-1 min-w-0 truncate" data-testid="region-name">{{ region.name }}</span>
        <span
          class="font-mono text-2xs text-ink-faint tabular-nums"
          [attr.aria-label]="'map.statusBar.hexCount' | transloco: { count: memberCount(region) }"
          >{{ memberCount(region) }}</span
        >
      </button>
    } @empty {
      <p class="muted text-sm leading-normal text-ink-muted">
        {{ 'map.regionsPanel.emptyHint' | transloco }}
      </p>
    }
  `,
  // Scoped chrome (ADR-0007): an accent-ringed swatch that brightens to a soft
  // glow on the selected Region.
  styles: `
    [appSwatch] {
      box-shadow:
        var(--shadow-inset),
        0 0 7px -2px currentColor;
    }
    [aria-current='true'] [appSwatch] {
      box-shadow:
        var(--shadow-inset),
        0 0 0 1px var(--color-accent),
        0 0 11px -1px currentColor;
    }
  `,
})
export class RegionsPanelComponent {
  protected readonly store = inject(HexMapStore);

  // Reads the selection set (not single selection view) to stay in sync during multi-selection.
  protected isRegionSelected(id: string): boolean {
    return this.store.selections().some((s) => s.kind === 'region' && s.id === id);
  }

  protected memberCount(region: Region): number {
    return Object.keys(region.hexes).length;
  }
}
