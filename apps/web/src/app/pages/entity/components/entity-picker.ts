import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntitySummary } from '@hexly/domain';
import { SuggestionMenu, SuggestionMenuProps } from './suggestion-menu';

/** What the `@`/`/link` suggestion plugin hands the picker on open/update. */
export type EntityPickerProps = SuggestionMenuProps<EntitySummary>;

/**
 * The keyboard-driven Entity picker that opens on `@` (and via the `/link` slash
 * item) in the Content editor (issue #95, ADR-0023). Same open/update/close/keyboard
 * behaviour as {@link SlashMenu} — both share {@link SuggestionMenu}; this is the
 * entity-result template over it. Matching by name is the suggestion plugin's job
 * (server-side `q` search, ADR-0025), so the picker only renders what it is handed.
 */
@Component({
  selector: 'app-entity-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  template: `
    @if (visible()) {
      <ul
        role="listbox"
        data-testid="entity-picker"
        [attr.aria-label]="'noteView.entityPicker.label' | transloco"
        [attr.aria-activedescendant]="activeItemId()"
        class="fixed z-50 max-h-72 w-64 overflow-auto rounded-md border border-line bg-surface py-1 shadow-2"
        [style.left.px]="position()!.x"
        [style.top.px]="position()!.y"
      >
        @for (item of items(); track item.id; let i = $index) {
          <li role="presentation">
            <button
              type="button"
              role="option"
              [id]="optionId(item.id)"
              [attr.data-testid]="'entity-picker-option-' + item.id"
              [attr.aria-selected]="i === activeIndex()"
              class="block w-full cursor-pointer px-3 py-1 text-left text-sm text-ink"
              [class.bg-surface-sunken]="i === activeIndex()"
              (mousedown)="$event.preventDefault()"
              (click)="select(item)"
            >
              {{ item.name }}
              <span class="font-mono text-2xs text-ink-muted">({{ item.type }})</span>
            </button>
          </li>
        } @empty {
          <li class="px-3 py-1 text-sm text-ink-muted">
            {{ 'noteView.entityPicker.empty' | transloco }}
          </li>
        }
      </ul>
    }
  `,
})
export class EntityPicker extends SuggestionMenu<EntitySummary> {
  protected readonly optionIdPrefix = 'entity-opt-';
}
