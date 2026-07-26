import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { coordKey, Label, TerrainId } from '@hexly/plugin-hexmap';
import { EntityLinkPickerComponent } from '@hexly/web-entity';
import { ButtonComponent, CoordComponent, EyebrowComponent, FieldComponent, InputComponent } from '@hexly/web-ui';
import { TranslocoPipe } from '@jsverse/transloco';
import { HexMapStore, Selection } from '../services/hexmap-store';
import { featureKey, terrainKey } from '../utils/catalog-keys';
import { inputValue } from '../utils/input-value';
import { RegionFieldsComponent } from './region-fields.component';

/** The Selection kinds, in the order the multi-selection breakdown lists them. */
const SELECTION_KINDS: readonly {
  kind: Selection['kind'];
  /** ICU plural key — renders both the count and the (localized) noun. */
  countKey: string;
}[] = [
  { kind: 'hex', countKey: 'map.inspector.kindHexCount' },
  { kind: 'feature', countKey: 'map.inspector.kindFeatureCount' },
  { kind: 'region', countKey: 'map.inspector.kindRegionCount' },
  { kind: 'label', countKey: 'map.inspector.kindLabelCount' },
];

/**
 * The membership-paint directions, as the Inspector's Add/Remove toggle pair. The
 * Inspector is the only place a Region's membership direction is set.
 */
const DIRECTIONS = [
  {
    direction: 'add',
    labelKey: 'map.inspector.add',
    testid: 'region-add',
  },
  {
    direction: 'remove',
    labelKey: 'map.inspector.remove',
    testid: 'region-remove',
  },
] as const;

/** A selected Hex or Feature resolved for display: its coordinate and identity. */
interface SelectedEntity {
  readonly kind: 'hex' | 'feature';
  readonly q: number;
  readonly r: number;
  /** The hex's terrain id, for the identity swatch colour. */
  readonly terrain: TerrainId;
  /**
   * The translation key for the entity's built-in catalog label, keyed by its stable
   * id (`map.terrain.<id>` / `map.feature.<id>`, ADR-0014): the Feature's key for a
   * Feature selection, else the Terrain's.
   */
  readonly detailKey: string;
  /** The hex's current name, or `''` when unnamed — what the Name input shows. */
  readonly name: string;
}

/**
 * The right rail: the editor for the current selection — a Label, a Region, or a
 * Hex/Feature — and a hint when nothing is selected. It is the only place a Region's
 * details are edited (CONTEXT.md → Inspector). Every field commits through the
 * {@link HexMapStore}, so each edit is undoable and persists. Delete dispatches through
 * {@link HexMapStore.deleteSelected}: a Hex erases the whole record, a Feature clears
 * only its feature, a Label is removed, a Region is destroyed.
 */
@Component({
  selector: 'app-inspector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex flex-col gap-4 p-4 overflow-y-auto bg-surface',
  },
  imports: [
    ButtonComponent,
    CoordComponent,
    EntityLinkPickerComponent,
    EyebrowComponent,
    FieldComponent,
    InputComponent,
    NgTemplateOutlet,
    RegionFieldsComponent,
    TranslocoPipe,
  ],
  template: `
    <!--
      The Entity Link control, declared once and outletted by each branch whose selection carries a
      link — a Hex, a Feature, or a Region, never a Label (CONTEXT.md → Map element). The link is the
      store's; the picker only shows it and offers the next one, and it resets on the selection, so
      opening it on one Hex and picking on another is impossible (#199).
    -->
    <ng-template #entityLink>
      <app-entity-link-picker
        [entityId]="store.selectedEntityLink()"
        [slot]="store.selection()"
        (linkChange)="onLink($event)"
      />
    </ng-template>

    @let label = store.selectedLabel();
    @let region = store.selectedRegion();
    @let entity = selectedEntity();
    @let multi = selectionSummary();
    @if (label) {
      <header class="flex items-center justify-between">
        <span appEyebrow mark>{{ 'map.inspector.selectedLabel' | transloco }}</span>
      </header>

      <div class="leaf">
        <div appField [label]="'map.inspector.text' | transloco">
          <input appInput data-testid="label-text" [value]="label.text" (change)="onText(label.id, $event)" />
        </div>

        <div appField [label]="'map.inspector.size' | transloco">
          <input
            appInput
            type="number"
            min="1"
            data-testid="label-size"
            [value]="label.size"
            (change)="onSize(label.id, $event)"
          />
        </div>

        <div appField [label]="'map.inspector.rotation' | transloco">
          <input
            appInput
            type="number"
            data-testid="label-rotation"
            [value]="label.rotation ?? 0"
            (change)="onRotation(label.id, $event)"
          />
        </div>

        <div class="flex gap-3">
          <div appField class="flex-1 min-w-0" [label]="'map.inspector.x' | transloco">
            <input
              appInput
              type="number"
              data-testid="label-x"
              [value]="label.position.x"
              (change)="onX(label, $event)"
            />
          </div>
          <div appField class="flex-1 min-w-0" [label]="'map.inspector.y' | transloco">
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
          {{ 'map.inspector.deleteLabel' | transloco }}
        </button>
      </div>
    } @else if (region) {
      <header class="flex items-center justify-between">
        <span appEyebrow mark>{{ 'map.inspector.selectedRegion' | transloco }}</span>
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
        <div appField [label]="'map.inspector.membership' | transloco">
          <div class="flex gap-2" role="group" [attr.aria-label]="'map.inspector.membershipDirection' | transloco">
            @for (d of directions; track d.direction) {
              <button
                type="button"
                class="flex-1 bg-transparent text-ink-muted border border-line rounded-sm py-1 px-3 text-xs font-semibold cursor-pointer aria-[pressed=true]:text-ink aria-[pressed=true]:border-accent aria-[pressed=true]:bg-accent-soft"
                [attr.aria-pressed]="store.regionDirection() === d.direction"
                [attr.data-testid]="d.testid"
                (click)="store.armRegionDirection(d.direction)"
              >
                {{ d.labelKey | transloco }}
              </button>
            }
          </div>
        </div>

        <ng-container [ngTemplateOutlet]="entityLink" />
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
          {{ 'map.inspector.deleteRegion' | transloco }}
        </button>
      </div>
    } @else if (entity) {
      <header class="flex items-center justify-between">
        <span appEyebrow mark>{{
          (entity.kind === 'feature' ? 'map.inspector.selectedFeature' : 'map.inspector.selectedHex') | transloco
        }}</span>
      </header>

      <div class="leaf">
        <div class="ident">
          <span class="ident-swatch" [style.background]="'var(--color-terrain-' + entity.terrain + ')'"></span>
          <div class="min-w-0">
            <div class="ident-name">
              {{ entity.name || (entity.detailKey | transloco) }}
            </div>
            <div class="ident-sub">
              <span data-testid="entity-detail">{{ entity.detailKey | transloco }}</span>
              <span class="opacity-50">·</span>
              <app-coord data-testid="entity-coord">q {{ entity.q }} · r {{ entity.r }}</app-coord>
            </div>
          </div>
        </div>

        <div appField [label]="'map.inspector.name' | transloco">
          <input appInput data-testid="entity-name" [value]="entity.name" (change)="onName(entity, $event)" />
        </div>

        <!--
          ponytail: stub — a Hex carries only terrain/feature/name; Tags live on the
          top-level Entity (CONTEXT.md). Placeholder until a Map element's Entity Link
          surfaces the linked Entity's tags here.
        -->
        <div appField [label]="'map.inspector.tags' | transloco">
          <span class="stub">{{ 'map.inspector.tagsEmpty' | transloco }}</span>
        </div>

        <ng-container [ngTemplateOutlet]="entityLink" />
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
          {{ (entity.kind === 'feature' ? 'map.inspector.deleteFeature' : 'map.inspector.deleteHex') | transloco }}
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
        <span appEyebrow mark>{{ 'map.inspector.multiTitle' | transloco }}</span>
      </header>

      <p class="text-sm font-semibold text-ink" data-testid="selection-count">
        {{ multi.count }}
        {{ 'map.inspector.selectedCount' | transloco }}
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
          {{ 'map.inspector.deleteAll' | transloco }}
        </button>
      </div>
    } @else {
      <header class="flex items-center justify-between">
        <span appEyebrow mark>{{ 'map.inspector.title' | transloco }}</span>
      </header>
      <p class="muted text-sm leading-normal text-ink-muted">
        {{ 'map.inspector.emptyHint' | transloco }}
      </p>
    }
  `,
  // Scoped chrome (ADR-0007): a framed "leaf" — accent corner brackets on lifted
  // paper — around each single-selection editor.
  styles: `
    @reference '#app-styles.css';

    .leaf {
      @apply relative flex flex-col gap-4 p-4 bg-surface-raised border border-line rounded-lg shadow-1;
    }
    .leaf::before,
    .leaf::after {
      content: '';
      @apply absolute w-3 h-3 border border-accent opacity-50 pointer-events-none;
    }
    .leaf::before {
      @apply top-1.5 left-1.5 border-r-0 border-b-0;
    }
    .leaf::after {
      @apply bottom-1.5 right-1.5 border-l-0 border-t-0;
    }
    /* Rich identity heading: terrain swatch + illuminated name + mono subtitle. */
    .ident {
      @apply flex items-center gap-3;
    }
    .ident-swatch {
      @apply w-[38px] h-[38px] flex-none rounded-md border border-line-strong;
      /* multi-shadow list: named token + literal geometry — stays raw (ADR-0031). */
      box-shadow:
        var(--shadow-inset),
        0 0 0 1px var(--color-accent-soft);
    }
    .ident-name {
      @apply font-display text-lg leading-[1.15] text-ink-strong overflow-hidden text-ellipsis whitespace-nowrap;
    }
    /* ponytail: kept raw — font-cartouche not in the listed font utilities, em values throughout. */
    .ident-name::first-letter {
      font-family: var(--font-cartouche);
      font-weight: 700;
      font-size: 1.5em;
      color: var(--color-accent);
      padding-right: 0.04em;
    }
    .ident-sub {
      @apply flex items-center gap-2 mt-0.5 font-mono text-2xs tracking-[0.02em] text-ink-muted;
    }
    .stub {
      @apply text-sm italic text-ink-faint;
    }
  `,
})
export class InspectorComponent {
  protected readonly store = inject(HexMapStore);

  /** The Add/Remove membership-direction toggle pair, for the template `@for`. */
  protected readonly directions = DIRECTIONS;

  /**
   * The selected Hex or Feature resolved for display, or `null` when the selection is
   * a Label, empty, or points at a coordinate that is no longer painted (e.g. after an
   * undo).
   */
  protected readonly selectedEntity = computed<SelectedEntity | null>(() => {
    const sel = this.store.selection();
    // A positive check keeps any future Selection kind out of this panel by default,
    // and narrows `sel` to the coordinate-bearing variants used just below.
    if (sel?.kind !== 'hex' && sel?.kind !== 'feature') return null;
    const hex = this.store.document().hexes[coordKey(sel.coord)];
    if (!hex) return null;
    // The ids are schema-constrained to the built-ins, so the key always resolves.
    const detailKey = hex.feature ? featureKey(hex.feature.ref) : terrainKey(hex.terrain);
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
   * The multi-selection summary — the set's size and a per-kind breakdown — or `null`
   * when fewer than two entities are selected. Kinds the set doesn't hold are filtered
   * away, so the breakdown lists only what is actually selected.
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

  /** Commit the picker's choice onto the selected Map element — an id links it, `null` unlinks it. */
  protected onLink(entityId: string | null): void {
    if (entityId) this.store.linkEntity(entityId);
    else this.store.unlinkEntity();
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
    this.store.moveLabel(label.id, {
      x: Number(inputValue(event)),
      y: label.position.y,
    });
  }

  protected onY(label: Label, event: Event): void {
    this.store.moveLabel(label.id, {
      x: label.position.x,
      y: Number(inputValue(event)),
    });
  }
}
