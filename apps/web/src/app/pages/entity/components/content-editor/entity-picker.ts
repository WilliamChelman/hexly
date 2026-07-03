import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntitySummary } from '@hexly/domain';
import { SuggestionMenu, SuggestionMenuProps } from './suggestion-menu';
import { SuggestionMenuShell } from './suggestion-menu-shell';
import { SuggestionEmpty, SuggestionOption } from './suggestion-option';

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
  imports: [TranslocoPipe, SuggestionMenuShell, SuggestionOption, SuggestionEmpty],
  template: `
    @if (visible()) {
      <app-suggestion-menu-shell
        testid="entity-picker"
        [ariaLabel]="'noteView.entityPicker.label' | transloco"
        [activeItemId]="activeItemId()"
        [x]="position()!.x"
        [y]="position()!.y"
      >
        @for (item of items(); track item.id; let i = $index) {
          <li
            appSuggestionOption
            [optionId]="optionId(item.id)"
            [testid]="'entity-picker-option-' + item.id"
            [selected]="i === activeIndex()"
            (pick)="select(item)"
          >
            {{ item.name }}
            <span class="font-mono text-2xs text-ink-muted">({{ item.type }})</span>
          </li>
        } @empty {
          <li appSuggestionEmpty>{{ 'noteView.entityPicker.empty' | transloco }}</li>
        }
      </app-suggestion-menu-shell>
    }
  `,
})
export class EntityPicker extends SuggestionMenu<EntitySummary> {
  protected readonly optionIdPrefix = 'entity-opt-';
}
