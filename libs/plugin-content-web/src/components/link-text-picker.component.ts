import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ListboxController, ListboxComponent, ListboxEmptyComponent, ListboxOptionComponent } from '@hexly/web-ui';
import { VocabItem } from '@hexly/plugin-content';

/** Which wikilink attr this picker edits — drives its testid and i18n only. */
export type LinkTextKind = 'display' | 'heading';

/**
 * The keyboard-driven picker behind the `|` display (`[[Target|text]]`) and `#` heading
 * (`[[Target#Heading]]`) triggers on an `entityLink` (ADR-0033). Free text only — there is no
 * vocabulary, so it shows the single typed row (the {@link VocabItem} `isNew` entry) that
 * {@link vocabItems} yields for an empty vocab, and an empty query shows a "type something"
 * prompt. `kind` picks the testid and the i18n strings.
 */
@Component({
  selector: 'app-link-text-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ListboxComponent, ListboxOptionComponent, ListboxEmptyComponent],
  template: `
    @if (visible()) {
      <app-listbox
        [testid]="kind() + '-picker'"
        [ariaLabel]="labelKey() | transloco"
        [activeItemId]="activeItemId()"
        [x]="position()!.x"
        [y]="position()!.y"
      >
        @for (item of items(); track item.id; let i = $index) {
          <li
            appListboxOption
            [optionId]="optionId(item.id)"
            [testid]="kind() + '-picker-option'"
            [selected]="i === activeIndex()"
            (pick)="select(item)"
          >
            @if (item.value) {
              {{ item.value }}
            } @else {
              <span class="text-ink-muted">{{ removeKey() | transloco }}</span>
            }
          </li>
        } @empty {
          <li appListboxEmpty>{{ emptyKey() | transloco }}</li>
        }
      </app-listbox>
    }
  `,
})
export class LinkTextPickerComponent extends ListboxController<VocabItem> {
  readonly kind = input.required<LinkTextKind>();
  protected readonly optionIdPrefix = 'link-text-opt-';

  protected readonly labelKey = computed(() => `editor.${this.kind()}Picker.label`);
  protected readonly emptyKey = computed(() => `editor.${this.kind()}Picker.empty`);
  protected readonly removeKey = computed(() => `editor.${this.kind()}Picker.remove`);
}
