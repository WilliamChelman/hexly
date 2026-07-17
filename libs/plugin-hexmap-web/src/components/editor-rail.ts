import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { IconButton, Icon, IconName } from '@hexly/web-ui';
import { HexMapStore } from '../services/hexmap-store';

/** The right panel's identity a rail entry can open (mirrors {@link HexMapStore.rightPanel}). */
type RightPanel = 'inspector' | 'regions';

/** A declarative rail entry: which panel it owns plus its icon-only button chrome. */
interface RailEntry {
  readonly id: RightPanel;
  readonly testid: string;
  /** Translation key for the entry's name, shown on its tooltip/aria-label (ADR-0014). */
  readonly titleKey: string;
  /** The glyph drawn in the button (ADR-0007). */
  readonly glyph: IconName;
}

/**
 * The right-edge icon rail — a narrow floating strip pinned top-right whose entries open
 * management panels into the dismissible right panel (ADR-0011, ADR-0013). The Regions entry
 * toggles the panel between the Regions list and closed ({@link HexMapStore.toggleRegionsPanel}),
 * and reads as active while that list is showing.
 */
@Component({
  selector: 'app-editor-rail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'flex flex-col items-center gap-2 p-2 bg-linear-[180deg] from-surface to-bg-deep border border-line rounded-lg shadow-2',
  },
  imports: [IconButton, Icon, TranslocoPipe],
  template: `
    @for (entry of entries; track entry.id) {
      <button
        appIconButton
        toggle
        [active]="store.rightPanel() === entry.id"
        [title]="entry.titleKey | transloco"
        [attr.aria-label]="entry.titleKey | transloco"
        [attr.data-testid]="entry.testid"
        (click)="store.toggleRegionsPanel()"
      >
        <app-icon [name]="entry.glyph" [size]="20" />
      </button>
    }
  `,
})
export class EditorRail {
  protected readonly store = inject(HexMapStore);

  /** Rail entries, rendered top-to-bottom. */
  protected readonly entries: readonly RailEntry[] = [
    {
      id: 'regions',
      testid: 'rail-regions',
      titleKey: 'map.regionsPanel.title',
      glyph: 'region',
    },
  ];
}
