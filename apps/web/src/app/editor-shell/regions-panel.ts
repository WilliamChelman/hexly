import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Button } from '../ui/button';
import { Eyebrow } from '../ui/eyebrow';
import { Swatch } from '../ui/swatch';
import { EditorStore } from './editor-store';

/**
 * The Regions panel — the right-edge rail's first entry, sharing the Inspector's
 * column (ADR-0011, issue #39). It is a Region's persistent management home: it
 * lists *every* Region with a colour swatch and name, including emptied Regions
 * (zero member hexes, so invisible on the canvas) — so it must never assume
 * non-empty membership — and offers a New Region action.
 *
 * Selecting a Region here routes through the *same* {@link EditorStore.selectRegion}
 * the canvas uses, so a list pick highlights on the canvas and opens in the
 * Inspector — which flips the shared column back to the Inspector. New Region mints
 * an empty "Region N" (next palette colour) without painting, then selects it so
 * the Inspector opens on it to be named.
 */
@Component({
  selector: 'app-regions-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Eyebrow, Swatch, TranslocoPipe],
  template: `
    <header class="head">
      <span appEyebrow>{{ 'editorShell.regionsPanel.title' | transloco }}</span>
      <button
        type="button"
        appButton
        variant="ghost"
        size="sm"
        data-testid="new-region"
        (click)="store.newRegion()"
      >
        {{ 'editorShell.regionsPanel.newRegion' | transloco }}
      </button>
    </header>

    @for (region of store.regions(); track region.id) {
      <button
        type="button"
        class="row"
        data-testid="region-item"
        [class.is-active]="isRegionSelected(region.id)"
        [attr.aria-current]="isRegionSelected(region.id) ? 'true' : null"
        (click)="store.selectRegion(region.id)"
      >
        <span appSwatch [style.background]="region.color"></span>
        <span class="name">{{ region.name }}</span>
      </button>
    } @empty {
      <p class="muted">{{ 'editorShell.regionsPanel.emptyHint' | transloco }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      padding: var(--spacing-4);
      overflow-y: auto;
      background: var(--color-surface);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-3);
    }
    .row {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      width: 100%;
      padding: var(--spacing-2) var(--spacing-3);
      font-size: var(--text-sm);
      color: var(--color-ink);
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      cursor: pointer;
      text-align: left;
    }
    .row:hover {
      background: var(--color-gold-soft);
    }
    .row.is-active {
      background: var(--color-gold-soft);
      border-color: var(--color-gold);
      color: var(--color-ink-strong);
    }
    .muted {
      font-size: var(--text-sm);
      line-height: var(--leading-normal);
      color: var(--color-ink-muted);
    }
    .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class RegionsPanel {
  protected readonly store = inject(EditorStore);

  /**
   * Whether a Region is part of the *live selection set* — the source of truth the
   * canvas highlights from. Reading the set (not the single {@link EditorStore.selection}
   * view, which is null whenever 2+ entities are selected) keeps the row's active
   * state in sync during a multi-selection, e.g. when Shift-clicking a hex inside a
   * Region adds both the hex and the Region. A sole selected Region is still in the
   * set, so single-selection behaviour is unchanged.
   */
  protected isRegionSelected(id: string): boolean {
    return this.store.selections().some((s) => s.kind === 'region' && s.id === id);
  }
}
