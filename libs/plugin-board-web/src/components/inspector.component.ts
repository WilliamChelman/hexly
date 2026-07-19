import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
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
  `,
})
export class InspectorComponent {
  protected readonly store = inject(BoardStore);

  /** The z-order actions for the template `@for`. */
  protected readonly zActions = Z_ACTIONS;

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
