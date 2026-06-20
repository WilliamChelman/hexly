import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A labelled field — stacks a small uppercase label above its projected
 * control. Uses an attribute selector so it keeps its host element (`<label>`,
 * `<div>`…). See ADR-0007.
 *
 *   <label appField label="Map name"><input appInput /></label>
 *   <div appField label="Terrain">…</div>
 */
@Component({
  selector: '[appField]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<span class="label">{{ label() }}</span><ng-content />',
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }
    .label {
      font-size: var(--text-xs);
      font-weight: var(--weight-semibold);
      color: var(--ink-muted);
      letter-spacing: var(--tracking-wide);
      text-transform: uppercase;
    }
  `,
})
export class Field {
  readonly label = input.required<string>();
}
