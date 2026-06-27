import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SlashItem } from './slash-menu-items';
import { SuggestionMenu, SuggestionMenuProps } from './suggestion-menu';

/** What the slash suggestion plugin hands the menu on open/update. */
export type SlashMenuProps = SuggestionMenuProps<SlashItem>;

/**
 * The keyboard-driven block picker that opens on `/` in the Content editor (#73).
 * Headless TipTap owns no chrome, so this is ours (ADR-0019). All the open/update/
 * close/keyboard state lives in {@link SuggestionMenu}; this is just the slash-item
 * template over it.
 */
@Component({
  selector: 'app-slash-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  template: `
    @if (visible()) {
      <ul
        role="listbox"
        data-testid="slash-menu"
        [attr.aria-label]="'noteView.slashMenu.label' | transloco"
        [attr.aria-activedescendant]="activeItemId()"
        class="fixed z-50 max-h-72 w-56 overflow-auto rounded-md border border-line bg-surface py-1 shadow-2"
        [style.left.px]="position()!.x"
        [style.top.px]="position()!.y"
      >
        @for (item of items(); track item.id; let i = $index) {
          <li role="presentation">
            <button
              type="button"
              role="option"
              [id]="optionId(item.id)"
              [attr.data-testid]="'slash-item-' + item.id"
              [attr.aria-selected]="i === activeIndex()"
              class="block w-full cursor-pointer px-3 py-1 text-left text-sm text-ink"
              [class.bg-surface-sunken]="i === activeIndex()"
              (mousedown)="$event.preventDefault()"
              (click)="select(item)"
            >
              {{ item.labelKey | transloco }}
            </button>
          </li>
        } @empty {
          <li class="px-3 py-1 text-sm text-ink-muted">
            {{ 'noteView.slashMenu.empty' | transloco }}
          </li>
        }
      </ul>
    }
  `,
})
export class SlashMenu extends SuggestionMenu<SlashItem> {
  protected readonly optionIdPrefix = 'slash-opt-';
}
