import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  ListboxController,
  ListboxComponent,
  ListboxEmptyComponent,
  ListboxOptionComponent,
  BodyPortalDirective,
} from '@hexly/web-ui';
import { VocabItem } from '@hexly/plugin-content';

/**
 * The keyboard-driven Link Descriptor picker that opens on `::` directly after an
 * `entityLink` (ADR-0023), over the owner's last-saved descriptor vocabulary. A row
 * flagged `isNew` is the typed free text offered as a brand-new descriptor; picking it
 * sets that text.
 */
@Component({
  selector: 'app-descriptor-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ListboxComponent, ListboxOptionComponent, ListboxEmptyComponent, BodyPortalDirective],
  template: `
    @if (visible()) {
      <app-listbox
        appBodyPortal
        testid="descriptor-picker"
        [ariaLabel]="'editor.descriptorPicker.label' | transloco"
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
              <span class="text-2xs text-ink-muted"> {{ 'editor.descriptorPicker.create' | transloco }}</span>
            }
          </li>
        } @empty {
          <li appListboxEmpty>
            {{ 'editor.descriptorPicker.empty' | transloco }}
          </li>
        }
      </app-listbox>
    }
  `,
})
export class DescriptorPickerComponent extends ListboxController<VocabItem> {
  protected readonly optionIdPrefix = 'descriptor-opt-';
}
