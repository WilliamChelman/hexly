import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RegionIcon } from '../ui/icon/glyphs/region';
import { EditorStore } from './editor-store';

/** The shared right column's panel identity (mirrors {@link EditorStore.rightPanel}). */
type RightPanel = 'inspector' | 'regions';

/** A declarative rail entry: which panel it owns plus its icon-only button chrome. */
interface RailEntry {
  readonly id: RightPanel;
  readonly testid: string;
  readonly title: string;
}

/**
 * The right-edge icon rail — a narrow vertical strip pinned to the right edge
 * whose entries open management panels into the shared right column (ADR-0011,
 * issue #39). It is built to take further entries later; only the Regions entry
 * ships now. The Regions entry toggles the shared column to the Regions panel
 * ({@link EditorStore.toggleRegionsPanel}); it reads as active while that list is
 * showing, and clicking it again yields the column back to the Inspector.
 *
 * Entries are declarative ({@link RAIL_ENTRIES}) so a second entry is a data
 * change, not copied markup; per ADR-0007 each glyph stays its own component, so
 * the @for keeps the Regions glyph inline and a new entry brings its own glyph.
 */
@Component({
  selector: 'app-editor-rail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RegionIcon],
  template: `
    @for (entry of entries; track entry.id) {
      <button
        type="button"
        class="entry"
        [class.is-active]="store.rightPanel() === entry.id"
        [attr.aria-pressed]="store.rightPanel() === entry.id"
        [title]="entry.title"
        [attr.aria-label]="entry.title"
        [attr.data-testid]="entry.testid"
        (click)="store.toggleRegionsPanel()"
      >
        <app-icon-region [size]="20" />
      </button>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) 0;
      overflow-y: auto;
      background: var(--bg-deep);
      border-left: 1px solid var(--line-strong);
    }
    .entry {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--space-7);
      height: var(--space-7);
      color: var(--ink-muted);
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      cursor: pointer;
      transition:
        background-color var(--dur-fast) var(--ease-out),
        border-color var(--dur-fast) var(--ease-out),
        color var(--dur-fast) var(--ease-out);
    }
    .entry:hover {
      color: var(--ink);
      background: var(--gold-soft);
    }
    .entry.is-active {
      color: var(--gold);
      background: var(--gold-soft);
      border-color: var(--gold);
    }
  `,
})
export class EditorRail {
  protected readonly store = inject(EditorStore);

  /** Rail entries rendered top-to-bottom; only Regions ships now (issue #39). */
  protected readonly entries: readonly RailEntry[] = [
    { id: 'regions', testid: 'rail-regions', title: 'Regions' },
  ];
}
