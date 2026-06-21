import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RegionIcon } from '../ui/icon/glyphs/region';
import { EditorStore } from './editor-store';

/**
 * The right-edge icon rail — a narrow vertical strip pinned to the right edge
 * whose entries open management panels into the shared right column (ADR-0011,
 * issue #39). It is built to take further entries later; only the Regions entry
 * ships now. The Regions entry flips the shared column to the Regions panel
 * ({@link EditorStore.showRegionsPanel}); it reads as active while that list is
 * showing. The reverse flip (back to the Inspector) is owned by selection, not the
 * rail, so selecting a Region from the list yields the column to its editor.
 *
 * Per ADR-0007 each glyph is its own component imported directly; a second entry
 * adds its own `<button class="entry">` with its own glyph here.
 */
@Component({
  selector: 'app-editor-rail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RegionIcon],
  template: `
    <button
      type="button"
      class="entry"
      [class.is-active]="store.rightPanel() === 'regions'"
      [attr.aria-pressed]="store.rightPanel() === 'regions'"
      title="Regions"
      aria-label="Regions"
      data-testid="rail-regions"
      (click)="store.showRegionsPanel()"
    >
      <app-icon-region [size]="20" />
    </button>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) 0;
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
}
