import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ENTITY_VIEW_CHOICES, EntityViewChoice, viewInstanceKey } from '@hexly/web-entity';
import { ButtonComponent, EyebrowComponent, FieldComponent, InputComponent } from '@hexly/web-ui';
import { BoardStore } from '../services/board-store';
import { inputValue } from '../utils/input-value';

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
            <input appInput type="number" data-testid="element-x" [value]="element.position.x" (change)="onX($event)" />
          </div>
          <div appField class="flex-1 min-w-0" [label]="'board.inspector.y' | transloco">
            <input appInput type="number" data-testid="element-y" [value]="element.position.y" (change)="onY($event)" />
          </div>
        </div>

        <div class="flex gap-3">
          <div appField class="flex-1 min-w-0" [label]="'board.inspector.width' | transloco">
            <input
              appInput
              type="number"
              min="1"
              data-testid="element-width"
              [value]="element.size.width"
              (change)="onWidth($event)"
            />
          </div>
          <div appField class="flex-1 min-w-0" [label]="'board.inspector.height' | transloco">
            <input
              appInput
              type="number"
              min="1"
              data-testid="element-height"
              [value]="element.size.height"
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

        <!-- An Embed's chosen View (ADR-0062): re-pick which of the target's Views the Embed transcludes. -->
        @if (element.kind === 'embed') {
          <div appField [label]="'board.inspector.embedView' | transloco">
            <select
              class="view-select"
              data-testid="embed-view-select"
              [value]="element.viewInstance"
              (change)="onEmbedView(element.id, $event)"
            >
              <option value="">{{ 'board.embedPicker.defaultView' | transloco }}</option>
              @for (choice of embedChoices(); track choice.key) {
                <option [value]="choice.key">{{ choice.label }}</option>
              }
            </select>
          </div>
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
  // Scoped chrome (ADR-0007): a framed "leaf" — gold corner brackets on lifted paper — around the
  // single-selection editor, mirroring the Hex Map Inspector.
  styles: `
    @reference '#app-styles.css';

    .leaf {
      @apply relative flex flex-col gap-4 p-4 bg-surface-raised border border-line rounded-lg shadow-1;
    }
    .leaf::before,
    .leaf::after {
      content: '';
      @apply absolute w-3 h-3 border border-gold opacity-50 pointer-events-none;
    }
    .leaf::before {
      @apply top-1.5 left-1.5 border-r-0 border-b-0;
    }
    .leaf::after {
      @apply bottom-1.5 right-1.5 border-l-0 border-t-0;
    }
    .view-select {
      @apply w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink;
      @apply focus-visible:border-gold outline-none;
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

  /** The selected Embed target's afforded Views (beyond its default), resolved across the seam for the View picker. */
  protected readonly embedChoices = signal<readonly (EntityViewChoice & { key: string })[]>([]);

  constructor() {
    // Reload the View options whenever the selected Embed's target changes; a non-Embed selection clears them.
    effect(() => {
      const targetId = this.embedTargetId();
      this.embedChoices.set([]);
      if (!targetId) return;
      this.viewChoices?.(targetId).subscribe((choices) =>
        this.embedChoices.set(choices.map((choice) => ({ ...choice, key: viewInstanceKey(choice.view) }))),
      );
    });
  }

  /** Re-point the selected Embed at the picked View (`''` = the target's default View). */
  protected onEmbedView(id: string, event: Event): void {
    this.store.setEmbedView(id, inputValue(event));
  }

  // Each geometry handler reads the *current* selected element, not the one bound at last render: a
  // second field edited before change detection re-runs must compose with the first, not clobber it
  // with a stale sibling coordinate.
  protected onX(event: Event): void {
    const current = this.store.selectedElement();
    if (current) this.store.move(current.id, { x: Number(inputValue(event)), y: current.position.y });
  }

  protected onY(event: Event): void {
    const current = this.store.selectedElement();
    if (current) this.store.move(current.id, { x: current.position.x, y: Number(inputValue(event)) });
  }

  protected onWidth(event: Event): void {
    const current = this.store.selectedElement();
    if (current) this.store.resize(current.id, { width: Number(inputValue(event)), height: current.size.height });
  }

  protected onHeight(event: Event): void {
    const current = this.store.selectedElement();
    if (current) this.store.resize(current.id, { width: current.size.width, height: Number(inputValue(event)) });
  }

  protected onZ(id: string, action: (typeof Z_ACTIONS)[number]['id']): void {
    this.store[action](id);
  }
}
