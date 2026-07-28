import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SlashItem } from '../models/slash-menu-items';
import {
  ListboxController,
  ListboxProps,
  ListboxComponent,
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
  imports: [TranslocoPipe, ListboxComponent, ListboxOptionComponent, ListboxEmptyComponent, BodyPortalDirective],
  template: `
    @if (visible()) {
      <app-listbox
        appBodyPortal
        testid="slash-menu"
        [ariaLabel]="'editor.slashMenu.label' | transloco"
        [activeItemId]="activeItemId()"
        [anchor]="anchor()!"
        [width]="224"
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
      </app-listbox>
    }
  `,
})
export class SlashMenuComponent extends ListboxController<SlashItem> {
  protected readonly optionIdPrefix = 'slash-opt-';
}
