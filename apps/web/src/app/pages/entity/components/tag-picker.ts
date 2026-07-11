import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ListboxController, Listbox, ListboxEmpty, ListboxOption } from '@hexly/web-ui';
import { TagItem } from './tag-suggestions';

/**
 * The keyboard-driven Tag entry picker: the Tag analog of {@link DescriptorPicker},
 * sharing {@link ListboxController}/{@link Listbox} but driven by the plain
 * {@link EntityTags} `<input>` (open/update/close/onKeyDown called by hand) rather than by
 * `@tiptap/suggestion`. A row flagged `isNew` is the typed free text offered as a brand-new
 * tag; picking it adds that text.
 */
@Component({
  selector: 'app-tag-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, Listbox, ListboxOption, ListboxEmpty],
  template: `
    @if (visible()) {
      <app-listbox
        testid="tag-picker"
        [ariaLabel]="'entityTags.picker.label' | transloco"
        [activeItemId]="activeItemId()"
        [x]="position()!.x"
        [y]="position()!.y"
      >
        @for (item of items(); track item.id; let i = $index) {
          <li
            appListboxOption
            [optionId]="optionId(item.id)"
            [testid]="'tag-picker-option-' + item.tag"
            [selected]="i === activeIndex()"
            (pick)="select(item)"
          >
            {{ item.tag }}
            @if (item.isNew) {
              <span class="text-2xs text-ink-muted"> {{ 'entityTags.picker.create' | transloco }}</span>
            }
          </li>
        } @empty {
          <li appListboxEmpty>{{ 'entityTags.picker.empty' | transloco }}</li>
        }
      </app-listbox>
    }
  `,
})
export class TagPicker extends ListboxController<TagItem> {
  protected readonly optionIdPrefix = 'tag-opt-';

  /** A row was picked (click or keyboard) — the parent adds this tag. */
  readonly picked = output<string>();

  /**
   * Angular-facing open: the parent hands rows + the anchor element; picks come back
   * via {@link picked}. This is where the `@tiptap/suggestion`-shaped callback plumbing
   * ({@link ListboxController.open}'s `command`/`clientRect`) is adapted to a plain input,
   * so the parent binds an idiomatic `(picked)` output instead of passing callbacks.
   */
  showFor(items: TagItem[], anchor: HTMLElement): void {
    this.open({
      items,
      command: (item) => this.picked.emit(item.tag),
      clientRect: () => anchor.getBoundingClientRect(),
    });
  }
}
