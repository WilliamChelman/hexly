import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { coordKey, Label, TerrainId } from '@hexly/domain';
import { Button } from '../ui/button';
import { Coord } from '../ui/coord';
import { Eyebrow } from '../ui/eyebrow';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { featureKey, terrainKey } from './catalog-keys';
import { inputValue } from './dom';
import { EditorStore, Selection } from './editor-store';
import { RegionFields } from './region-fields';

/**
 * The Selection kinds in the order the multi-selection breakdown lists them, each
 * paired with its singular and plural translation keys so a row of count 1 reads
 * "1 hex" not "1 hexes". A single table so the breakdown can't list a kind the
 * set never holds, nor drift from the labels (ADR-0017).
 */
const SELECTION_KINDS: readonly {
  kind: Selection['kind'];
  /** ICU plural key — renders both the count and the (localized) noun. */
  countKey: string;
}[] = [
  { kind: 'hex', countKey: 'editorShell.inspector.kindHexCount' },
  { kind: 'feature', countKey: 'editorShell.inspector.kindFeatureCount' },
  { kind: 'region', countKey: 'editorShell.inspector.kindRegionCount' },
  { kind: 'label', countKey: 'editorShell.inspector.kindLabelCount' },
];

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
  /** The hex's terrain id, for the identity swatch colour. */
  readonly terrain: TerrainId;
  /**
   * The translation key for the entity's built-in catalog label, keyed by its
   * stable id (`domain.terrain.<id>` / `domain.feature.<id>`, ADR-0014): the
   * Feature's key for a Feature selection, else the Terrain's. The catalog label
   * is localized at this UI layer, not in the framework-agnostic domain lib.
   */
  readonly detailKey: string;
  /** The hex's current name, or `''` when unnamed — what the Name input shows. */
  readonly name: string;
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
  host: {
    class: 'flex flex-col gap-4 p-4 overflow-y-auto bg-surface',
  },
  imports: [Button, Coord, Eyebrow, Field, Input, RegionFields, TranslocoPipe],
  template: `
    @let label = store.selectedLabel();
    @let region = store.selectedRegion();
    @let entity = selectedEntity();
    @let multi = selectionSummary();
    @if (label) {
      <header class="flex items-center justify-between">
        <span appEyebrow mark>{{ 'editorShell.inspector.selectedLabel' | transloco }}</span>
      </header>

      <div class="leaf">
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

      <div class="flex gap-3">
        <div appField class="flex-1 min-w-0" [label]="'editorShell.inspector.x' | transloco">
          <input
            appInput
            type="number"
            data-testid="label-x"
            [value]="label.position.x"
            (change)="onX(label, $event)"
          />
        </div>
        <div appField class="flex-1 min-w-0" [label]="'editorShell.inspector.y' | transloco">
          <input
            appInput
            type="number"
            data-testid="label-y"
            [value]="label.position.y"
            (change)="onY(label, $event)"
          />
        </div>
      </div>

      </div>

      <div class="flex gap-2 mt-auto pt-2">
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
      <header class="flex items-center justify-between">
        <span appEyebrow mark>{{ 'editorShell.inspector.selectedRegion' | transloco }}</span>
      </header>

      <div class="leaf">
      <app-region-fields [region]="region" />

      <!--
        Engaging either button auto-arms the Region tool on this Region with the
        chosen membership direction (issue #37) — the only control outside the
        palette permitted to arm a Tool. The active button (styled off its own
        aria-pressed via an aria-[pressed=true]: variant) is driven from the
        same store.regionDirection() the brush paints by, so the active one reads
        as set and can never disagree with the stroke.
      -->
      <div appField [label]="'editorShell.inspector.membership' | transloco">
        <div
          class="flex gap-2"
          role="group"
          [attr.aria-label]="'editorShell.inspector.membershipDirection' | transloco"
        >
          @for (d of directions; track d.direction) {
            <button
              type="button"
              class="flex-1 bg-transparent text-ink-muted border border-line rounded-sm py-1 px-3 text-xs font-semibold cursor-pointer aria-[pressed=true]:text-ink aria-[pressed=true]:border-gold aria-[pressed=true]:bg-gold-soft"
              [attr.aria-pressed]="store.regionDirection() === d.direction"
              [attr.data-testid]="d.testid"
              (click)="store.armRegionDirection(d.direction)"
            >
              {{ d.labelKey | transloco }}
            </button>
          }
        </div>
      </div>

      </div>

      <div class="flex gap-2 mt-auto pt-2">
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
      <header class="flex items-center justify-between">
        <span appEyebrow mark>{{
          (entity.kind === 'feature'
            ? 'editorShell.inspector.selectedFeature'
            : 'editorShell.inspector.selectedHex') | transloco
        }}</span>
      </header>

      <div class="leaf">
        <div class="ident">
          <span
            class="ident-swatch"
            [style.background]="'var(--color-terrain-' + entity.terrain + ')'"
          ></span>
          <div class="min-w-0">
            <div class="ident-name">{{ entity.name || (entity.detailKey | transloco) }}</div>
            <div class="ident-sub">
              <span data-testid="entity-detail">{{ entity.detailKey | transloco }}</span>
              <span class="opacity-50">·</span>
              <app-coord data-testid="entity-coord">q {{ entity.q }} · r {{ entity.r }}</app-coord>
            </div>
          </div>
        </div>

        <div appField [label]="'editorShell.inspector.name' | transloco">
          <input
            appInput
            data-testid="entity-name"
            [value]="entity.name"
            (change)="onName(entity, $event)"
          />
        </div>

        <!--
          ponytail: stub — a Hex carries only terrain/feature/name; Tags live on the
          top-level Entity (CONTEXT.md). Placeholder until a Map element's Entity Link
          surfaces the linked Entity's tags here.
        -->
        <div appField [label]="'editorShell.inspector.tags' | transloco">
          <span class="stub">{{ 'editorShell.inspector.tagsEmpty' | transloco }}</span>
        </div>

        <!--
          ponytail: stub — the Entity Link is not on the Hex model yet (CONTEXT.md: Map
          elements *can* carry one). Placeholder until it is wired through the store.
        -->
        <div appField [label]="'editorShell.inspector.linkedEntity' | transloco">
          <span class="stub">{{ 'editorShell.inspector.notLinked' | transloco }}</span>
        </div>
      </div>

      <div class="flex gap-2 mt-auto pt-2">
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
    } @else if (multi) {
      <!--
        Two or more selected: no single-entity editor fits, so the Inspector shows
        the set's size and a per-kind breakdown plus a Delete all action that
        removes the whole set in one undo step (ADR-0017). Bulk field editing
        across the set is deliberately out of scope.
      -->
      <header class="flex items-center justify-between">
        <span appEyebrow mark>{{ 'editorShell.inspector.multiTitle' | transloco }}</span>
      </header>

      <p class="text-sm font-semibold text-ink" data-testid="selection-count">
        {{ multi.count }} {{ 'editorShell.inspector.selectedCount' | transloco }}
      </p>

      <ul class="m-0 pl-4 flex flex-col gap-1 text-sm text-ink-muted" data-testid="selection-breakdown">
        @for (group of multi.groups; track group.countKey) {
          <li>
            {{ group.countKey | transloco: { count: group.count } }}
          </li>
        }
      </ul>

      <div class="flex gap-2 mt-auto pt-2">
        <button
          type="button"
          appButton
          variant="ghost"
          size="sm"
          danger
          data-testid="selection-delete-all"
          (click)="store.deleteSelected()"
        >
          {{ 'editorShell.inspector.deleteAll' | transloco }}
        </button>
      </div>
    } @else {
      <header class="flex items-center justify-between">
        <span appEyebrow mark>{{ 'editorShell.inspector.title' | transloco }}</span>
      </header>
      <p class="muted text-sm leading-normal text-ink-muted">{{ 'editorShell.inspector.emptyHint' | transloco }}</p>
    }
  `,
  // Celestial Codex right-rail touches (ADR-0007, scoped to this component): a
  // framed "leaf" — gold corner brackets on lifted paper — around each
  // single-selection editor. (The eyebrow ✦ mark is the Eyebrow `mark` variant.)
  styles: `
    .leaf {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
      padding: var(--spacing-4);
      background: var(--color-surface-raised);
      border: 1px solid var(--color-line);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-1);
    }
    .leaf::before,
    .leaf::after {
      content: '';
      position: absolute;
      width: 12px;
      height: 12px;
      border: 1px solid var(--color-gold);
      opacity: 0.5;
      pointer-events: none;
    }
    .leaf::before {
      top: 6px;
      left: 6px;
      border-right: 0;
      border-bottom: 0;
    }
    .leaf::after {
      bottom: 6px;
      right: 6px;
      border-left: 0;
      border-top: 0;
    }
    /* Rich identity heading: terrain swatch + illuminated name + mono subtitle. */
    .ident {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
    }
    .ident-swatch {
      width: 38px;
      height: 38px;
      flex: none;
      border-radius: var(--radius-md);
      border: 1px solid var(--color-line-strong);
      box-shadow: var(--shadow-inset), 0 0 0 1px var(--color-gold-soft);
    }
    .ident-name {
      font-family: var(--font-display);
      font-size: var(--text-lg);
      line-height: 1.15;
      color: var(--color-ink-strong);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ident-name::first-letter {
      font-family: var(--font-cartouche);
      font-weight: 700;
      font-size: 1.5em;
      color: var(--color-gold);
      padding-right: 0.04em;
    }
    .ident-sub {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin-top: 2px;
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: 0.02em;
      color: var(--color-ink-muted);
    }
    .stub {
      font-size: var(--text-sm);
      font-style: italic;
      color: var(--color-ink-faint);
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
    // terrain; the ids are schema-constrained to the built-ins, so the key
    // always resolves.
    const detailKey = hex.feature
      ? featureKey(hex.feature.ref)
      : terrainKey(hex.terrain);
    return {
      kind: sel.kind,
      q: sel.coord.q,
      r: sel.coord.r,
      terrain: hex.terrain,
      detailKey,
      name: hex.name ?? '',
    };
  });

  /**
   * The multi-selection summary — the set's size and a per-kind breakdown — or
   * `null` when fewer than two entities are selected (a single selection has its
   * own editor; an empty selection the hint). Resolved from the live
   * {@link EditorStore.selections} set, so it self-heals as members drop out
   * (ADR-0017). Kinds the set doesn't hold are filtered away, so the breakdown
   * lists only what is actually selected.
   */
  protected readonly selectionSummary = computed(() => {
    const sels = this.store.selections();
    if (sels.length < 2) return null;
    const groups = SELECTION_KINDS.map(({ kind, countKey }) => ({
      countKey,
      count: sels.filter((s) => s.kind === kind).length,
    })).filter((g) => g.count > 0);
    return { count: sels.length, groups };
  });

  protected onName(entity: SelectedEntity, event: Event): void {
    this.store.editHexName({ q: entity.q, r: entity.r }, inputValue(event));
  }

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
