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
  host: {
    class: 'flex flex-col gap-2 p-4 overflow-y-auto bg-surface',
  },
  imports: [Button, Eyebrow, Swatch, TranslocoPipe],
  template: `
    <header class="flex items-center justify-between gap-3">
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
        class="flex items-center gap-3 w-full py-2 px-3 text-sm text-ink bg-transparent border border-transparent rounded-md cursor-pointer text-left hover:bg-gold-soft aria-[current=true]:bg-gold-soft aria-[current=true]:border-gold aria-[current=true]:text-ink-strong"
        data-testid="region-item"
        [attr.aria-current]="isRegionSelected(region.id) ? 'true' : null"
        (click)="store.selectRegion(region.id)"
      >
        <span appSwatch [style.background]="region.color"></span>
        <span class="flex-1 min-w-0 truncate">{{ region.name }}</span>
      </button>
    } @empty {
      <p class="muted text-sm leading-normal text-ink-muted">{{ 'editorShell.regionsPanel.emptyHint' | transloco }}</p>
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
