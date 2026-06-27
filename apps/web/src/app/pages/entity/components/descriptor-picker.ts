import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SuggestionMenu } from './suggestion-menu';
import { DescriptorItem } from './descriptors';

/**
 * The keyboard-driven Link Descriptor picker that opens on `::` directly after an
 * `entityLink` (issue #96, ADR-0023). Same open/update/close/keyboard behaviour as the
 * {@link EntityPicker} — both share {@link SuggestionMenu} — over the owner's last-saved
 * descriptor vocabulary. A row flagged `isNew` is the typed free text offered as a
 * brand-new descriptor (never boxed into the suggestions); picking it sets that text.
 */
@Component({
  selector: 'app-descriptor-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  template: `
    @if (visible()) {
      <ul
        role="listbox"
        data-testid="descriptor-picker"
        [attr.aria-label]="'noteView.descriptorPicker.label' | transloco"
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
              [attr.data-testid]="'descriptor-picker-option-' + item.descriptor"
              [attr.aria-selected]="i === activeIndex()"
              class="block w-full cursor-pointer px-3 py-1 text-left text-sm text-ink"
              [class.bg-surface-sunken]="i === activeIndex()"
              (mousedown)="$event.preventDefault()"
              (click)="select(item)"
            >
              {{ item.descriptor }}
              @if (item.isNew) {
                <span class="text-2xs text-ink-muted">
                  {{ 'noteView.descriptorPicker.create' | transloco }}</span
                >
              }
            </button>
          </li>
        } @empty {
          <li class="px-3 py-1 text-sm text-ink-muted">
            {{ 'noteView.descriptorPicker.empty' | transloco }}
          </li>
        }
      </ul>
    }
  `,
})
export class DescriptorPicker extends SuggestionMenu<DescriptorItem> {
  protected readonly optionIdPrefix = 'descriptor-opt-';
}
