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
  host: { class: 'flex flex-col gap-1' },
  template:
    '<span class="text-xs font-semibold text-ink-muted tracking-wide uppercase">{{ label() }}</span><ng-content />',
})
export class Field {
  readonly label = input.required<string>();
}
