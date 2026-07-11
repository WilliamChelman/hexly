import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ListboxController, Listbox, ListboxEmpty, ListboxOption } from '@hexly/web-ui';
import { VocabItem } from './vocab-items';

/**
 * The keyboard-driven Link Descriptor picker that opens on `::` directly after an
 * `entityLink` (issue #96, ADR-0023). Same open/update/close/keyboard behaviour as the
 * {@link EntityPicker} — both share {@link ListboxController} and {@link Listbox}
 * — over the owner's last-saved descriptor vocabulary. A row flagged `isNew` is the typed
 * free text offered as a brand-new descriptor (never boxed into the suggestions); picking
 * it sets that text.
 */
@Component({
  selector: 'app-descriptor-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Listbox, ListboxOption, ListboxEmpty],
  template: `
    @if (visible()) {
      <app-listbox
        testid="descriptor-picker"
        [ariaLabel]="'noteView.descriptorPicker.label' | transloco"
        [activeItemId]="activeItemId()"
        [x]="position()!.x"
        [y]="position()!.y"
      >
        @for (item of items(); track item.id; let i = $index) {
          <li
            appListboxOption
            [optionId]="optionId(item.id)"
            [testid]="'descriptor-picker-option-' + item.value"
            [selected]="i === activeIndex()"
            (pick)="select(item)"
          >
            {{ item.value }}
            @if (item.isNew) {
              <span class="text-2xs text-ink-muted"> {{ 'noteView.descriptorPicker.create' | transloco }}</span>
            }
          </li>
        } @empty {
          <li appListboxEmpty>
            {{ 'noteView.descriptorPicker.empty' | transloco }}
          </li>
        }
      </app-listbox>
    }
  `,
})
export class DescriptorPicker extends ListboxController<VocabItem> {
  protected readonly optionIdPrefix = 'descriptor-opt-';
}
