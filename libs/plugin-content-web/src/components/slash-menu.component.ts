import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SlashItem } from '../models/slash-menu-items';
import {
  ListboxController,
  ListboxProps,
  ListboxEmptyComponent,
  ListboxOptionComponent,
  BodyPortalDirective,
} from '@hexly/web-ui';

/** What the slash suggestion plugin hands the menu on open/update. */
export type SlashMenuProps = ListboxProps<SlashItem>;

/**
 * The keyboard-driven block picker that opens on `/` in the Content editor.
 * Open/update/close/keyboard state lives in {@link ListboxController}; this is the
 * slash-item template over it.
 */
@Component({
  selector: 'app-slash-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ListboxOptionComponent, ListboxEmptyComponent, BodyPortalDirective],
  template: `
    @if (visible()) {
      <ul
        appBodyPortal
        role="listbox"
        data-testid="slash-menu"
        [attr.aria-label]="'editor.slashMenu.label' | transloco"
        [attr.aria-activedescendant]="activeItemId()"
        class="fixed z-50 max-h-72 w-56 overflow-auto rounded-md border border-line bg-surface py-1 shadow-2"
        [style.left.px]="position()!.x"
        [style.top.px]="position()!.y"
      >
        @for (item of items(); track item.id; let i = $index) {
          <li
            appListboxOption
            [optionId]="optionId(item.id)"
            [testid]="'slash-item-' + item.id"
            [selected]="i === activeIndex()"
            (pick)="select(item)"
          >
            {{ item.labelKey | transloco }}
          </li>
        } @empty {
          <li appListboxEmpty>{{ 'editor.slashMenu.empty' | transloco }}</li>
        }
      </ul>
    }
  `,
})
export class SlashMenuComponent extends ListboxController<SlashItem> {
  protected readonly optionIdPrefix = 'slash-opt-';
}
