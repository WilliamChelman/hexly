import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconButton, IconButtonGlyph } from '../ui/icon-button';
import { EditorStore } from './editor-store';

/** The right panel's identity a rail entry can open (mirrors {@link EditorStore.rightPanel}). */
type RightPanel = 'inspector' | 'regions';

/** A declarative rail entry: which panel it owns plus its icon-only button chrome. */
interface RailEntry {
  readonly id: RightPanel;
  readonly testid: string;
  readonly title: string;
  readonly glyph: IconButtonGlyph;
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
  imports: [IconButton],
  template: `
    @for (entry of entries; track entry.id) {
      <button
        appIconButton
        toggle
        [glyph]="entry.glyph"
        [active]="store.rightPanel() === entry.id"
        [title]="entry.title"
        [attr.aria-label]="entry.title"
        [attr.data-testid]="entry.testid"
        (click)="store.toggleRegionsPanel()"
      ></button>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2);
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-1);
    }
  `,
})
export class EditorRail {
  protected readonly store = inject(EditorStore);

  /** Rail entries rendered top-to-bottom; only Regions ships now (issue #39). */
  protected readonly entries: readonly RailEntry[] = [
    { id: 'regions', testid: 'rail-regions', title: 'Regions', glyph: 'region' },
  ];
}
