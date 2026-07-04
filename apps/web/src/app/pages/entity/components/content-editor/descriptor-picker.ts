import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SuggestionMenu } from './suggestion-menu';
import { SuggestionMenuShell } from './suggestion-menu-shell';
import { SuggestionEmpty, SuggestionOption } from './suggestion-option';
import { VocabItem } from './vocab-items';

/**
 * The keyboard-driven Link Descriptor picker that opens on `::` directly after an
 * `entityLink` (issue #96, ADR-0023). Same open/update/close/keyboard behaviour as the
 * {@link EntityPicker} — both share {@link SuggestionMenu} and {@link SuggestionMenuShell}
 * — over the owner's last-saved descriptor vocabulary. A row flagged `isNew` is the typed
 * free text offered as a brand-new descriptor (never boxed into the suggestions); picking
 * it sets that text.
 */
@Component({
  selector: 'app-descriptor-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, SuggestionMenuShell, SuggestionOption, SuggestionEmpty],
  template: `
    @if (visible()) {
      <app-suggestion-menu-shell
        testid="descriptor-picker"
        [ariaLabel]="'noteView.descriptorPicker.label' | transloco"
        [activeItemId]="activeItemId()"
        [x]="position()!.x"
        [y]="position()!.y"
      >
        @for (item of items(); track item.id; let i = $index) {
          <li
            appSuggestionOption
            [optionId]="optionId(item.id)"
            [testid]="'descriptor-picker-option-' + item.value"
            [selected]="i === activeIndex()"
            (pick)="select(item)"
          >
            {{ item.value }}
            @if (item.isNew) {
              <span class="text-2xs text-ink-muted">
                {{ 'noteView.descriptorPicker.create' | transloco }}</span
              >
            }
          </li>
        } @empty {
          <li appSuggestionEmpty>{{ 'noteView.descriptorPicker.empty' | transloco }}</li>
        }
      </app-suggestion-menu-shell>
    }
  `,
})
export class DescriptorPicker extends SuggestionMenu<VocabItem> {
  protected readonly optionIdPrefix = 'descriptor-opt-';
}
