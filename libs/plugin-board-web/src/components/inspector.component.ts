import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ENTITY_VIEW_CHOICES } from '@hexly/web-entity';
import { ButtonComponent, EyebrowComponent, FieldComponent, InputComponent } from '@hexly/web-ui';
import { BoardElement } from '@hexly/plugin-board';
import { BoardStore } from '../services/board-store';
import { inputNumber, inputValue } from '../utils/input-value';
import { keyedViewChoices, KeyedViewChoice } from '../utils/embed-view-choices';

/** The z-order actions, as the Inspector's stacking controls — each dispatches a pure reordering. */
const Z_ACTIONS = [
  { id: 'toFront', labelKey: 'board.inspector.toFront', testid: 'z-to-front' },
  { id: 'bringForward', labelKey: 'board.inspector.bringForward', testid: 'z-forward' },
  { id: 'sendBackward', labelKey: 'board.inspector.sendBackward', testid: 'z-backward' },
  { id: 'toBack', labelKey: 'board.inspector.toBack', testid: 'z-to-back' },
] as const;

/**
 * The right rail: the editor for the current selection (CONTEXT.md → Inspector, #267). For a single
 * selected Board Element it shows and edits the two things dragging can't do precisely — its **geometry**
 * (position and size) and its **z-order** (bring forward / send backward / to front / to back). For two
 * or more it shows the set's size and a Delete-all. Every field commits through the {@link BoardStore},
 * so each edit is undoable and persists; the geometry/z-order controls are surface-agnostic, so the Text
 * Block (#268) and Image (#269) kinds inherit them unchanged — only their kind-specific fields are added.
 */
@Component({
  selector: 'app-board-inspector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4 p-4 overflow-y-auto bg-surface' },
  imports: [ButtonComponent, EyebrowComponent, FieldComponent, InputComponent, TranslocoPipe],
  template: `
    @let element = store.selectedElement();
    @let count = store.selectedIds().length;
    @if (element) {
      <header class="flex items-center justify-between">
        <span appEyebrow mark>{{ 'board.inspector.selectedElement' | transloco }}</span>
      </header>

      <div class="leaf">
        <div class="flex gap-3">
          <div appField class="flex-1 min-w-0" [label]="'board.inspector.x' | transloco">
            <input
              appInput
              type="number"
              data-testid="element-x"
              [value]="round(element.position.x)"
              (focus)="onGeometryFocus(element.id)"
              (blur)="onGeometryBlur()"
              (change)="onX($event)"
            />
          </div>
          <div appField class="flex-1 min-w-0" [label]="'board.inspector.y' | transloco">
            <input
              appInput
              type="number"
              data-testid="element-y"
              [value]="round(element.position.y)"
              (focus)="onGeometryFocus(element.id)"
              (blur)="onGeometryBlur()"
              (change)="onY($event)"
            />
          </div>
        </div>

        <div class="flex gap-3">
          <div appField class="flex-1 min-w-0" [label]="'board.inspector.width' | transloco">
            <input
              appInput
              type="number"
              min="1"
              data-testid="element-width"
              [value]="round(element.size.width)"
              (focus)="onGeometryFocus(element.id)"
              (blur)="onGeometryBlur()"
              (change)="onWidth($event)"
            />
          </div>
          <div appField class="flex-1 min-w-0" [label]="'board.inspector.height' | transloco">
            <input
              appInput
              type="number"
              min="1"
              data-testid="element-height"
              [value]="round(element.size.height)"
              (focus)="onGeometryFocus(element.id)"
              (blur)="onGeometryBlur()"
              (change)="onHeight($event)"
            />
          </div>
        </div>

        <div appField [label]="'board.inspector.order' | transloco">
          <div class="grid grid-cols-2 gap-2" role="group" [attr.aria-label]="'board.inspector.order' | transloco">
            @for (z of zActions; track z.id) {
              <button
                type="button"
                appButton
                variant="ghost"
                size="sm"
                [attr.data-testid]="z.testid"
                (click)="onZ(element.id, z.id)"
              >
                {{ z.labelKey | transloco }}
              </button>
            }
          </div>
        </div>

        <!-- An Embed's chosen View (ADR-0062): re-pick which of the target's Views the Embed transcludes.
             Rendered only once the choices resolve: painted sooner, the select could only show the default
             option — misreporting a non-default viewInstance, and a "confirming" change would silently
             re-point the Embed at ''. The pick rides [selected] on each option, not [value] on the select:
             a value binding applies before the @for creates its options, so it can never land on a
             not-yet-rendered choice. -->
        @if (element.kind === 'embed') {
          @if (embedChoices(); as choices) {
            <div appField [label]="'board.inspector.embedView' | transloco">
              <select class="view-select" data-testid="embed-view-select" (change)="onEmbedView(element.id, $event)">
                <option value="" [selected]="element.viewInstance === ''">
                  {{ 'board.embedPicker.defaultView' | transloco }}
                </option>
                @for (choice of choices; track choice.key) {
                  <option [value]="choice.key" [selected]="choice.key === element.viewInstance">
                    {{ choice.label }}
                  </option>
                }
              </select>
            </div>
          }
        }
      </div>

      <div class="flex gap-2 mt-auto pt-2">
        <button
          type="button"
          appButton
          variant="ghost"
          size="sm"
          danger
          data-testid="element-delete"
          (click)="store.delete()"
        >
          {{ 'board.inspector.deleteElement' | transloco }}
        </button>
      </div>
    } @else if (count >= 2) {
      <header class="flex items-center justify-between">
        <span appEyebrow mark>{{ 'board.inspector.multiTitle' | transloco }}</span>
      </header>

      <p class="text-sm font-semibold text-ink" data-testid="selection-count">
        {{ count }} {{ 'board.inspector.selectedCount' | transloco }}
      </p>

      <div class="flex gap-2 mt-auto pt-2">
        <button
          type="button"
          appButton
          variant="ghost"
          size="sm"
          danger
          data-testid="selection-delete-all"
          (click)="store.delete()"
        >
          {{ 'board.inspector.deleteAll' | transloco }}
        </button>
      </div>
    } @else {
      <header class="flex items-center justify-between">
        <span appEyebrow mark>{{ 'board.inspector.title' | transloco }}</span>
      </header>
      <p class="muted text-sm leading-normal text-ink-muted">
        {{ 'board.inspector.emptyHint' | transloco }}
      </p>
    }
  `,
  // Scoped chrome (ADR-0007): a framed "leaf" — accent corner brackets on lifted paper — around the
  // single-selection editor, mirroring the Hex Map Inspector.
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
    .view-select {
      @apply w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink;
      @apply focus-visible:border-accent outline-none;
    }
  `,
})
export class InspectorComponent {
  protected readonly store = inject(BoardStore);
  private readonly viewChoices = inject(ENTITY_VIEW_CHOICES, { optional: true });

  /** The z-order actions for the template `@for`. */
  protected readonly zActions = Z_ACTIONS;

  /** The selected Embed's target id, or `null` when the selection isn't a single Embed — the choices key. */
  private readonly embedTargetId = computed(() => {
    const element = this.store.selectedElement();
    return element?.kind === 'embed' ? element.targetEntityId : null;
  });

  /**
   * The selected Embed target's afforded Views (beyond its default), resolved across the seam for the
   * View picker; `null` while the request is in flight, so the template can withhold the select until
   * the loaded options can actually represent the Embed's `viewInstance`.
   */
  protected readonly embedChoices = signal<readonly KeyedViewChoice[] | null>(null);

  /**
   * The id of the element whose geometry field is being edited, captured when the field takes focus.
   * `change` fires at blur — *after* a canvas pointerdown may have re-pointed the selection — so reading
   * `selectedElement()` at event time would land the pending value on the newly selected element.
   */
  private editingId: string | null = null;

  constructor() {
    // Reload the View options whenever the selected Embed's target changes; a non-Embed selection clears
    // them. `onCleanup` cancels the prior in-flight request on a target change, so an out-of-order
    // response never paints Embed A's Views under Embed B (ADR-0062).
    effect((onCleanup) => {
      const targetId = this.embedTargetId();
      this.embedChoices.set(null);
      if (!targetId) return;
      const sub = keyedViewChoices(this.viewChoices, targetId).subscribe((choices) => this.embedChoices.set(choices));
      onCleanup(() => sub.unsubscribe());
    });
  }

  /** Re-point the selected Embed at the picked View (`''` = the target's default View). */
  protected onEmbedView(id: string, event: Event): void {
    this.store.setEmbedView(id, inputValue(event));
  }

  protected onGeometryFocus(id: string): void {
    this.editingId = id;
  }

  protected onGeometryBlur(): void {
    // `change` fires before `blur`, so a pending commit has already consumed the captured id.
    this.editingId = null;
  }

  /** Geometry for display: at most 2 decimals — a drag can leave 10+, which overflows the field. Commits keep the full typed precision. */
  protected round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  // Each geometry handler resolves its target through `editingTarget()` — the element the user typed
  // into, at its *current* state — so a second field edited before change detection re-runs composes
  // with the first instead of clobbering it with a stale sibling coordinate.
  protected onX(event: Event): void {
    this.commitGeometry(
      event,
      (element) => element.position.x,
      (element, x) => this.store.move(element.id, { x, y: element.position.y }),
    );
  }

  protected onY(event: Event): void {
    this.commitGeometry(
      event,
      (element) => element.position.y,
      (element, y) => this.store.move(element.id, { x: element.position.x, y }),
    );
  }

  protected onWidth(event: Event): void {
    this.commitGeometry(
      event,
      (element) => element.size.width,
      (element, width) => this.store.resize(element.id, { width, height: element.size.height }),
      1,
    );
  }

  protected onHeight(event: Event): void {
    this.commitGeometry(
      event,
      (element) => element.size.height,
      (element, height) => this.store.resize(element.id, { width: element.size.width, height }),
      1,
    );
  }

  protected onZ(id: string, action: (typeof Z_ACTIONS)[number]['id']): void {
    this.store[action](id);
  }

  /**
   * Commit one geometry field. Empty, non-finite, or below-`min` input commits nothing and the field
   * reverts to the model — a typed negative used to clamp to the `min="1"` floor, leaving a 1px sliver
   * element nobody asked for; reverting treats it like a cleared field (the store's finiteness/positivity
   * guards remain the deep guard). The input is then rewritten from the model, because the `[value]`
   * binding won't repaint a rejected entry on its own — the model didn't change — and the field would
   * keep lying.
   */
  private commitGeometry(
    event: Event,
    read: (element: BoardElement) => number,
    apply: (element: BoardElement, value: number) => void,
    min?: number,
  ): void {
    const target = this.editingTarget();
    const typed = inputNumber(event);
    if (target && typed !== null && (min === undefined || typed >= min)) apply(target, typed);
    // Sync to whichever element the field is *rendering* now — after a mid-edit re-point that is the
    // newly selected element, not the commit's target.
    const shown = this.store.selectedElement();
    if (shown) (event.target as HTMLInputElement).value = String(this.round(read(shown)));
  }

  /**
   * The element a pending geometry commit targets: the one captured at focus if it still exists (it may
   * no longer be the selection — the commit must follow the user's edit, not the re-pointed selection),
   * else the current selection (a change with no preceding focus, e.g. programmatic).
   */
  private editingTarget(): BoardElement | null {
    const id = this.editingId ?? this.store.selectedElement()?.id;
    return id ? (this.store.document().elements.find((e) => e.id === id) ?? null) : null;
  }
}
