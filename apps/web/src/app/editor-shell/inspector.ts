import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { coordKey, featureLabel, Label, terrainLabel } from '@hexly/domain';
import { Button } from '../ui/button';
import { Coord } from '../ui/coord';
import { Eyebrow } from '../ui/eyebrow';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { inputValue } from './dom';
import { EditorStore } from './editor-store';
import { RegionFields } from './region-fields';

/**
 * The membership-paint directions, as the Inspector's Add/Remove toggle pair,
 * kept in one data table so the two buttons can't drift. The Inspector is the
 * only place a Region's membership direction is set now that the Region tool's
 * legend is gone (issue #38).
 */
const DIRECTIONS = [
  { direction: 'add', labelKey: 'editorShell.inspector.add', testid: 'region-add' },
  { direction: 'remove', labelKey: 'editorShell.inspector.remove', testid: 'region-remove' },
] as const;

/** A selected Hex or Feature resolved for display: its coordinate and identity. */
interface SelectedEntity {
  readonly kind: 'hex' | 'feature';
  readonly q: number;
  readonly r: number;
  /**
   * The translation key for the entity's built-in catalog label, keyed by its
   * stable id (`domain.terrain.<id>` / `domain.feature.<id>`, ADR-0014): the
   * Feature's key for a Feature selection, else the Terrain's. The catalog label
   * is localized at this UI layer, not in the framework-agnostic domain lib.
   */
  readonly detailKey: string;
}

/**
 * The right rail. It reflects the single selection (issue #28): a selected Label
 * gets its full editor — text, size, rotation and world position, plus Delete
 * (issue #10); a selected Region gets a name, color, and Delete editor (issue
 * #36) — the only place a Region's details are edited (CONTEXT.md → Inspector);
 * while a selected Hex or Feature gets a minimal panel showing its identity and a
 * Delete action. The entity panel's Delete dispatches through the store's single
 * {@link EditorStore.deleteSelected} gesture (issue #29): a Hex erases the whole
 * record, a Feature clears only its feature, a Label is removed, a Region is
 * destroyed. Every field commits through the {@link EditorStore}, so each edit is
 * undoable and persists. With nothing selected it shows a hint instead.
 */
@Component({
  selector: 'app-inspector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Coord, Eyebrow, Field, Input, RegionFields, TranslocoPipe],
  template: `
    @let label = store.selectedLabel();
    @let region = store.selectedRegion();
    @let entity = selectedEntity();
    @if (label) {
      <header class="head">
        <span appEyebrow>{{ 'editorShell.inspector.selectedLabel' | transloco }}</span>
      </header>

      <div appField [label]="'editorShell.inspector.text' | transloco">
        <input
          appInput
          data-testid="label-text"
          [value]="label.text"
          (change)="onText(label.id, $event)"
        />
      </div>

      <div appField [label]="'editorShell.inspector.size' | transloco">
        <input
          appInput
          type="number"
          min="1"
          data-testid="label-size"
          [value]="label.size"
          (change)="onSize(label.id, $event)"
        />
      </div>

      <div appField [label]="'editorShell.inspector.rotation' | transloco">
        <input
          appInput
          type="number"
          data-testid="label-rotation"
          [value]="label.rotation ?? 0"
          (change)="onRotation(label.id, $event)"
        />
      </div>

      <div class="pos">
        <div appField [label]="'editorShell.inspector.x' | transloco">
          <input
            appInput
            type="number"
            data-testid="label-x"
            [value]="label.position.x"
            (change)="onX(label, $event)"
          />
        </div>
        <div appField [label]="'editorShell.inspector.y' | transloco">
          <input
            appInput
            type="number"
            data-testid="label-y"
            [value]="label.position.y"
            (change)="onY(label, $event)"
          />
        </div>
      </div>

      <div class="actions">
        <button
          type="button"
          appButton
          variant="ghost"
          size="sm"
          danger
          data-testid="label-delete"
          (click)="store.deleteLabel(label.id)"
        >
          {{ 'editorShell.inspector.deleteLabel' | transloco }}
        </button>
      </div>
    } @else if (region) {
      <header class="head">
        <span appEyebrow>{{ 'editorShell.inspector.selectedRegion' | transloco }}</span>
      </header>

      <app-region-fields [region]="region" />

      <!--
        Engaging either button auto-arms the Region tool on this Region with the
        chosen membership direction (issue #37) — the only control outside the
        palette permitted to arm a Tool. The active button (the .active class +
        aria-pressed) is driven from the same store.regionDirection() the brush
        paints by, so the active one reads as set and can never disagree with the
        stroke.
      -->
      <div appField [label]="'editorShell.inspector.membership' | transloco">
        <div
          class="direction"
          role="group"
          [attr.aria-label]="'editorShell.inspector.membershipDirection' | transloco"
        >
          @for (d of directions; track d.direction) {
            <button
              type="button"
              class="mode"
              [class.active]="store.regionDirection() === d.direction"
              [attr.aria-pressed]="store.regionDirection() === d.direction"
              [attr.data-testid]="d.testid"
              (click)="store.armRegionDirection(d.direction)"
            >
              {{ d.labelKey | transloco }}
            </button>
          }
        </div>
      </div>

      <div class="actions">
        <button
          type="button"
          appButton
          variant="ghost"
          size="sm"
          danger
          data-testid="region-delete"
          (click)="store.deleteRegion(region.id)"
        >
          {{ 'editorShell.inspector.deleteRegion' | transloco }}
        </button>
      </div>
    } @else if (entity) {
      <header class="head">
        <span appEyebrow>{{
          (entity.kind === 'feature'
            ? 'editorShell.inspector.selectedFeature'
            : 'editorShell.inspector.selectedHex') | transloco
        }}</span>
      </header>

      <div appField [label]="'editorShell.inspector.coordinate' | transloco">
        <app-coord data-testid="entity-coord"
          >q {{ entity.q }} · r {{ entity.r }}</app-coord
        >
      </div>

      <div
        appField
        [label]="
          (entity.kind === 'feature'
            ? 'editorShell.inspector.feature'
            : 'editorShell.inspector.terrain') | transloco
        "
      >
        <span class="detail" data-testid="entity-detail">{{
          entity.detailKey | transloco
        }}</span>
      </div>

      <div class="actions">
        <button
          type="button"
          appButton
          variant="ghost"
          size="sm"
          danger
          data-testid="entity-delete"
          (click)="store.deleteSelected()"
        >
          {{
            (entity.kind === 'feature'
              ? 'editorShell.inspector.deleteFeature'
              : 'editorShell.inspector.deleteHex') | transloco
          }}
        </button>
      </div>
    } @else {
      <header class="head">
        <span appEyebrow>{{ 'editorShell.inspector.title' | transloco }}</span>
      </header>
      <p class="muted">{{ 'editorShell.inspector.emptyHint' | transloco }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      padding: var(--space-4);
      overflow-y: auto;
      background: var(--surface);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .pos {
      display: flex;
      gap: var(--space-3);
    }
    .direction {
      display: flex;
      gap: var(--space-2);
    }
    /* The armed-mode affordance: a quiet outline that fills gold-soft when active,
       not the global primary call-to-action variant. Stretched to share the row. */
    .mode {
      flex: 1;
      background: none;
      color: var(--ink-muted);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: var(--space-1) var(--space-3);
      font-size: var(--text-xs);
      font-weight: var(--weight-semibold);
      cursor: pointer;
    }
    .mode.active {
      color: var(--ink);
      border-color: var(--gold);
      background: var(--gold-soft);
    }
    .pos > div {
      flex: 1;
      min-width: 0;
    }
    .muted {
      font-size: var(--text-sm);
      line-height: var(--leading-normal);
      color: var(--ink-muted);
    }
    .detail {
      font-size: var(--text-sm);
      color: var(--ink);
    }
    .actions {
      display: flex;
      gap: var(--space-2);
      margin-top: auto;
      padding-top: var(--space-2);
    }
  `,
})
export class Inspector {
  protected readonly store = inject(EditorStore);

  /** The Add/Remove membership-direction toggle pair, for the template `@for`. */
  protected readonly directions = DIRECTIONS;

  /**
   * The selected Hex or Feature resolved for display, or `null` when the
   * selection is a Label, empty, or points at a coordinate that is no longer
   * painted (e.g. after an undo). Identity *display* — the terrain and feature
   * labels — is presentation, resolved here; the selection precedence itself
   * lives in the store (issue #28).
   */
  protected readonly selectedEntity = computed<SelectedEntity | null>(() => {
    const sel = this.store.selection();
    // Only a Hex/Feature selection drives this identity panel: a Label has the
    // label editor and a Region its own Inspector editor (issue #36). A positive
    // check keeps any future Selection kind out of this panel by default and
    // narrows `sel` to the coordinate-bearing variants used just below.
    if (sel?.kind !== 'hex' && sel?.kind !== 'feature') return null;
    const hex = this.store.document().hexes[coordKey(sel.coord)];
    if (!hex) return null;
    // Resolve the built-in catalog label at the UI layer, keyed by stable id
    // (ADR-0014). A Feature selection shows the feature's label, else the hex's
    // terrain. `terrainLabel`/`featureLabel` confirm the id is a built-in; an
    // unknown id (unreachable under the schema) falls back to the raw id so the
    // panel still shows something rather than a dangling key.
    const detailKey = hex.feature
      ? featureLabel(hex.feature.ref)
        ? `domain.feature.${hex.feature.ref}`
        : hex.feature.ref
      : terrainLabel(hex.terrain)
        ? `domain.terrain.${hex.terrain}`
        : hex.terrain;
    return { kind: sel.kind, q: sel.coord.q, r: sel.coord.r, detailKey };
  });

  protected onText(id: string, event: Event): void {
    this.store.editLabelText(id, inputValue(event));
  }

  protected onSize(id: string, event: Event): void {
    this.store.resizeLabel(id, Number(inputValue(event)));
  }

  protected onRotation(id: string, event: Event): void {
    this.store.rotateLabel(id, Number(inputValue(event)));
  }

  protected onX(label: Label, event: Event): void {
    this.store.moveLabel(label.id, { x: Number(inputValue(event)), y: label.position.y });
  }

  protected onY(label: Label, event: Event): void {
    this.store.moveLabel(label.id, { x: label.position.x, y: Number(inputValue(event)) });
  }
}
