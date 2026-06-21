import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Button } from '../ui/button';
import { Eyebrow } from '../ui/eyebrow';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { EditorStore } from './editor-store';

/**
 * The right rail. When a Label is selected it becomes that label's editor —
 * text, size, rotation and world position, plus Delete (issue #10). Every field
 * commits through the {@link EditorStore}, so each edit is undoable and persists.
 * With nothing selected it shows a hint instead.
 */
@Component({
  selector: 'app-inspector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Eyebrow, Field, Input],
  template: `
    @let label = store.selectedLabel();
    @if (label) {
      <header class="head">
        <span appEyebrow>Selected label</span>
      </header>

      <div appField label="Text">
        <input
          appInput
          data-testid="label-text"
          [value]="label.text"
          (change)="onText($event)"
        />
      </div>

      <div appField label="Size">
        <input
          appInput
          type="number"
          min="1"
          data-testid="label-size"
          [value]="label.size"
          (change)="onSize($event)"
        />
      </div>

      <div appField label="Rotation (°)">
        <input
          appInput
          type="number"
          data-testid="label-rotation"
          [value]="label.rotation ?? 0"
          (change)="onRotation($event)"
        />
      </div>

      <div class="pos">
        <div appField label="X">
          <input
            appInput
            type="number"
            data-testid="label-x"
            [value]="label.position.x"
            (change)="onX($event)"
          />
        </div>
        <div appField label="Y">
          <input
            appInput
            type="number"
            data-testid="label-y"
            [value]="label.position.y"
            (change)="onY($event)"
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
          Delete label
        </button>
      </div>
    } @else {
      <header class="head">
        <span appEyebrow>Inspector</span>
      </header>
      <p class="muted">
        Place a Label with the Label tool, then select it here to edit its text,
        size, rotation and position.
      </p>
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
      border-left: 1px solid var(--line-strong);
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
    .pos > div {
      flex: 1;
      min-width: 0;
    }
    .muted {
      font-size: var(--text-sm);
      line-height: var(--leading-normal);
      color: var(--ink-muted);
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

  /** The label currently being edited, asserted non-null by the template guard. */
  private requireSelected() {
    const label = this.store.selectedLabel();
    if (!label) throw new Error('No label selected');
    return label;
  }

  protected onText(event: Event): void {
    this.store.editLabelText(this.requireSelected().id, value(event));
  }

  protected onSize(event: Event): void {
    this.store.resizeLabel(this.requireSelected().id, Number(value(event)));
  }

  protected onRotation(event: Event): void {
    this.store.rotateLabel(this.requireSelected().id, Number(value(event)));
  }

  protected onX(event: Event): void {
    const label = this.requireSelected();
    this.store.moveLabel(label.id, { x: Number(value(event)), y: label.position.y });
  }

  protected onY(event: Event): void {
    const label = this.requireSelected();
    this.store.moveLabel(label.id, { x: label.position.x, y: Number(value(event)) });
  }
}

/** The current value of the input that raised `event`. */
function value(event: Event): string {
  return (event.target as HTMLInputElement).value;
}
