import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
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
  imports: [Button, Eyebrow, Swatch],
  template: `
    <header class="head">
      <span appEyebrow>Regions</span>
      <button
        type="button"
        appButton
        variant="ghost"
        size="sm"
        data-testid="new-region"
        (click)="store.newRegion()"
      >
        New Region
      </button>
    </header>

    @for (region of store.regions(); track region.id) {
      <button
        type="button"
        class="row"
        data-testid="region-item"
        [class.is-active]="store.selectedRegion()?.id === region.id"
        [attr.aria-current]="
          store.selectedRegion()?.id === region.id ? 'true' : null
        "
        (click)="store.selectRegion(region.id)"
      >
        <span appSwatch [style.background]="region.color"></span>
        <span class="name">{{ region.name }}</span>
      </button>
    } @empty {
      <p class="muted">
        No regions yet. Use New Region to mint one, then paint its member hexes
        from the Inspector.
      </p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-4);
      overflow-y: auto;
      background: var(--surface);
      border-left: 1px solid var(--line-strong);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
    }
    .row {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      width: 100%;
      padding: var(--space-2) var(--space-3);
      font-size: var(--text-sm);
      color: var(--ink);
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      cursor: pointer;
      text-align: left;
    }
    .row:hover {
      background: var(--gold-soft);
    }
    .row.is-active {
      background: var(--gold-soft);
      border-color: var(--gold);
      color: var(--ink-strong);
    }
    .muted {
      font-size: var(--text-sm);
      line-height: var(--leading-normal);
      color: var(--ink-muted);
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
}
