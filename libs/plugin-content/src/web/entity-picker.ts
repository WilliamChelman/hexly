import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntitySummary } from '@hexly/domain';
import { ListboxController, ListboxProps, Listbox, ListboxEmpty, ListboxOption } from '@hexly/web-ui';

/** What the `@`/`/link` suggestion plugin hands the picker on open/update. */
export type EntityPickerProps = ListboxProps<EntitySummary>;

/**
 * The keyboard-driven Entity picker that opens on `@` (and via the `/link` slash item).
 * Matching by name is the suggestion plugin's job (server-side `q` search, ADR-0025);
 * the picker only renders what it is handed.
 */
@Component({
  selector: 'app-entity-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Listbox, ListboxOption, ListboxEmpty],
  template: `
    @if (visible()) {
      <app-listbox
        testid="entity-picker"
        [ariaLabel]="'editor.entityPicker.label' | transloco"
        [activeItemId]="activeItemId()"
        [x]="position()!.x"
        [y]="position()!.y"
      >
        @for (item of items(); track item.id; let i = $index) {
          <li
            appListboxOption
            [optionId]="optionId(item.id)"
            [testid]="'entity-picker-option-' + item.id"
            [selected]="i === activeIndex()"
            (pick)="select(item)"
          >
            {{ item.name }}
            <span class="font-mono text-2xs text-ink-muted">({{ item.types[0] }})</span>
          </li>
        } @empty {
          <li appListboxEmpty>
            {{ 'editor.entityPicker.empty' | transloco }}
          </li>
        }
      </app-listbox>
    }
  `,
})
export class EntityPicker extends ListboxController<EntitySummary> {
  protected readonly optionIdPrefix = 'entity-opt-';
}
