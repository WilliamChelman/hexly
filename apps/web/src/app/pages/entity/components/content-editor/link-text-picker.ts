import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SuggestionMenu } from './suggestion-menu';
import { SuggestionMenuShell } from './suggestion-menu-shell';
import { SuggestionEmpty, SuggestionOption } from './suggestion-option';
import { VocabItem } from './vocab-items';

/** Which wikilink attr this picker edits — drives its testid and i18n only. */
export type LinkTextKind = 'display' | 'heading';

/**
 * The keyboard-driven picker behind the `|` display (`[[Target|text]]`) and `#` heading
 * (`[[Target#Heading]]`) triggers on an `entityLink` (ADR-0033). Free text only — there is
 * no vocabulary, so it shows the single typed row (the {@link VocabItem} `isNew`
 * entry) that {@link vocabItems} yields for an empty vocab, and an empty query shows
 * a "type something" prompt. One component drives both attrs: `kind` picks the testid and
 * the i18n strings; the `::` descriptor picker keeps its own because it lists a vocabulary.
 */
@Component({
  selector: 'app-link-text-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, SuggestionMenuShell, SuggestionOption, SuggestionEmpty],
  template: `
    @if (visible()) {
      <app-suggestion-menu-shell
        [testid]="kind() + '-picker'"
        [ariaLabel]="labelKey() | transloco"
        [activeItemId]="activeItemId()"
        [x]="position()!.x"
        [y]="position()!.y"
      >
        @for (item of items(); track item.id; let i = $index) {
          <li
            appSuggestionOption
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
          <li appSuggestionEmpty>{{ emptyKey() | transloco }}</li>
        }
      </app-suggestion-menu-shell>
    }
  `,
})
export class LinkTextPicker extends SuggestionMenu<VocabItem> {
  readonly kind = input.required<LinkTextKind>();
  protected readonly optionIdPrefix = 'link-text-opt-';

  protected readonly labelKey = computed(() => `noteView.${this.kind()}Picker.label`);
  protected readonly emptyKey = computed(() => `noteView.${this.kind()}Picker.empty`);
  protected readonly removeKey = computed(() => `noteView.${this.kind()}Picker.remove`);
}
