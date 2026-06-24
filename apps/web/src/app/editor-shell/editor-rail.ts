import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Type,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { IconButton } from '../ui/icon-button';
import { RegionIcon } from '../ui/icon/glyphs/region';
import { EditorStore } from './editor-store';

/** The right panel's identity a rail entry can open (mirrors {@link EditorStore.rightPanel}). */
type RightPanel = 'inspector' | 'regions';

/** A declarative rail entry: which panel it owns plus its icon-only button chrome. */
interface RailEntry {
  readonly id: RightPanel;
  readonly testid: string;
  /** Translation key for the entry's name, shown on its tooltip/aria-label (ADR-0014). */
  readonly titleKey: string;
  /** The glyph component projected into the button (ADR-0007); rendered via outlet. */
  readonly glyph: Type<unknown>;
}

/**
 * The right-edge icon rail — a narrow floating strip pinned top-right whose
 * entries open management panels into the dismissible right panel (ADR-0011,
 * ADR-0013, issue #39). It is built to take further entries later; only the
 * Regions entry ships now. The Regions entry toggles the panel between the
 * Regions list and closed ({@link EditorStore.toggleRegionsPanel}); it reads as
 * active while that list is showing, and clicking it again reclaims the map.
 *
 * Each entry's chrome — its glyph, tooltip, and active state — is data ({@link
 * entries}) rendered by a shared {@link IconButton}, so a second entry brings its
 * own glyph without copied markup, per ADR-0013's "every widget is a primitive."
 * (Its panel-specific toggle is the one piece still wired in the template; only
 * the Regions entry ships, so there is a single handler today.)
 */
@Component({
  selector: 'app-editor-rail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'flex flex-col items-center gap-2 p-2 bg-surface border border-line rounded-lg shadow-1',
  },
  imports: [IconButton, NgComponentOutlet, TranslocoPipe],
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
        <ng-container *ngComponentOutlet="entry.glyph; inputs: glyphInputs" />
      </button>
    }
  `,
})
export class EditorRail {
  protected readonly store = inject(EditorStore);

  /** Inputs for each outlet-rendered glyph; matches the 20px icon-only chrome. */
  protected readonly glyphInputs = { size: 20 };

  /** Rail entries rendered top-to-bottom; only Regions ships now (issue #39). */
  protected readonly entries: readonly RailEntry[] = [
    {
      id: 'regions',
      testid: 'rail-regions',
      titleKey: 'editorShell.regionsPanel.title',
      glyph: RegionIcon,
    },
  ];
}
