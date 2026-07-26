import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  ListboxController,
  ListboxProps,
  ListboxComponent,
  ListboxEmptyComponent,
  ListboxOptionComponent,
  BodyPortalDirective,
} from '@hexly/web-ui';
import { MentionItem } from '../extensions/mention-items';

/** What the `@`/`/link` suggestion plugin hands the picker on open/update. */
export type EntityPickerProps = ListboxProps<MentionItem>;

/**
 * The keyboard-driven Entity picker that opens on `@` (and via the `/link` slash item).
 * Matching by name is the suggestion plugin's job (server-side `q` search, ADR-0025);
 * the picker only renders what it is handed — the matches, then the `Create "…"` row that
 * mints the typed name and the `Create "…" with details…` row that mints it through the create
 * dialog (ADR-0073), both reached by the same arrow keys.
 */
@Component({
  selector: 'app-entity-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ListboxComponent, ListboxOptionComponent, ListboxEmptyComponent, BodyPortalDirective],
  template: `
    @if (visible()) {
      <app-listbox
        appBodyPortal
        testid="entity-picker"
        [ariaLabel]="'editor.entityPicker.label' | transloco"
        [activeItemId]="activeItemId()"
        [x]="position()!.x"
        [y]="position()!.y"
      >
        @for (item of items(); track item.id; let i = $index) {
          @if (item.kind === 'entity') {
            <li
              appListboxOption
              [optionId]="optionId(item.id)"
              [testid]="'entity-picker-option-' + item.id"
              [selected]="i === activeIndex()"
              (pick)="select(item)"
            >
              {{ item.entity.name }}
              <span class="font-mono text-2xs text-ink-muted">({{ item.entity.types[0] }})</span>
            </li>
          } @else if (item.kind === 'create') {
            <li
              appListboxOption
              [optionId]="optionId(item.id)"
              testid="entity-picker-create"
              [selected]="i === activeIndex()"
              (pick)="select(item)"
            >
              {{ 'editor.entityPicker.create' | transloco: { name: item.name } }}
            </li>
          } @else {
            <li
              appListboxOption
              [optionId]="optionId(item.id)"
              testid="entity-picker-create-details"
              [selected]="i === activeIndex()"
              (pick)="select(item)"
            >
              {{ 'editor.entityPicker.createDetails' | transloco: { name: item.name } }}
            </li>
          }
        } @empty {
          <li appListboxEmpty>
            {{ 'editor.entityPicker.empty' | transloco }}
          </li>
        }
      </app-listbox>
    }
  `,
})
export class EntityPickerComponent extends ListboxController<MentionItem> {
  protected readonly optionIdPrefix = 'entity-opt-';
}
