import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { translateSignal, TranslocoPipe } from '@jsverse/transloco';
import { catchError, firstValueFrom, of } from 'rxjs';
import { ChipComponent } from '@hexly/web-ui';
import { EntitiesClient } from '@hexly/web-core';
import { EntitySession } from '../services/entity-session';
import { TagPickerComponent } from './tag-picker.component';
import { tagItems, withTags } from './tag-suggestions';

/**
 * Free-text tag editor for the open Entity (CONTEXT.md → Tag), with autocomplete over the
 * owner's tag vocabulary. Changes persist through the version-checked Save, shared with Content.
 */
@Component({
  selector: 'app-entity-tags',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChipComponent, TranslocoPipe, TagPickerComponent],
  template: `
    <div class="flex flex-wrap items-center gap-2" data-testid="entity-tags">
      @for (tag of tags(); track tag) {
        <app-chip>
          {{ tag }}
          <!-- The remove affordance is edit-only: a read-only opener sees the tag, can't drop it. -->
          @if (writable()) {
            <button
              type="button"
              class="-mr-1 leading-none opacity-70 hover:opacity-100 cursor-pointer bg-transparent border-0 text-current"
              [attr.aria-label]="'entityTags.removeLabel' | transloco: { tag }"
              [attr.data-testid]="'tag-remove-' + tag"
              (click)="remove(tag)"
            >
              &times;
            </button>
          }
        </app-chip>
      }
      <!-- The add input is edit-only (ADR-0037); read-only shows just the existing tags. -->
      @if (writable()) {
        <input
          #tagInput
          type="text"
          data-testid="tag-input"
          class="min-w-32 flex-1 bg-transparent border-0 text-sm text-ink outline-none placeholder:text-ink-muted"
          [attr.aria-label]="addLabel()"
          [attr.placeholder]="addPlaceholder()"
          (input)="suggest()"
          (keydown)="onKeyDown($event)"
          (blur)="add($event)"
        />
      }
    </div>
    <app-tag-picker (picked)="commit($event)" />
  `,
})
export class EntityTagsComponent {
  private readonly session = inject(EntitySession);
  private readonly entities = inject(EntitiesClient);
  protected readonly tags = this.session.tags;
  /** Read-only openers (ADR-0037) see the tags but not the add/remove affordances. */
  protected readonly writable = this.session.writable;
  protected readonly addLabel = translateSignal('entityTags.addLabel');
  protected readonly addPlaceholder = translateSignal('entityTags.addPlaceholder');
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('tagInput');
  private readonly picker = viewChild.required(TagPickerComponent);

  // Fetched lazily on first keystroke and memoized for the component's lifetime; reflects
  // last-saved state. Caching the in-flight promise (not just its result) makes a fast burst of
  // keystrokes fire one request; catchError → [] degrades a failed fetch to "no suggestions".
  private vocab: Promise<readonly string[]> | undefined;

  /** Open/refresh the suggestion menu for the current input text. */
  protected async suggest(): Promise<void> {
    const el = this.input().nativeElement;
    const query = el.value;
    this.vocab ??= firstValueFrom(this.entities.listTags().pipe(catchError(() => of<string[]>([]))));
    const items = tagItems(query, await this.vocab, this.tags());
    // No trigger char, so a non-empty query with matches is the analog gate (ADR-0023).
    if (!query.trim() || !items.length) {
      this.picker().close();
      return;
    }
    this.picker().showFor(items, el);
  }

  /**
   * The menu wins the arrow/Enter/Tab/Escape keys while open: Enter commits the highlighted
   * suggestion. When the menu is closed, Enter falls through to {@link add} so a query the
   * menu never showed still adds as raw text.
   */
  protected onKeyDown(event: KeyboardEvent): void {
    // Tab keeps its native focus-move even with the menu open. The shared menu (built for
    // the in-editor `::` picker) commits on Tab, which would trap focus on the input and
    // insert the highlighted suggestion — wrong for a form field, so intercept it first.
    if (event.key === 'Tab') {
      this.picker().close();
      return;
    }
    if (this.picker().onKeyDown(event)) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') this.add(event);
  }

  /** Add the picked tag(s) and clear the input (the suggestion menu closes itself). */
  protected commit(tag: string): void {
    this.addTags(tag);
    this.input().nativeElement.value = '';
  }

  /**
   * Fires on Enter (when no suggestion is highlighted) and blur (#88 — blur prevents losing
   * a typed-but-not-confirmed tag when the user clicks Save).
   */
  protected add(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addTags(input.value);
    input.value = '';
    this.picker().close();
  }

  /** Normalization is shared with the create dialog's tag editor, so the two cannot drift. */
  private addTags(raw: string): void {
    const next = withTags(this.tags(), raw);
    if (next.length !== this.tags().length) this.session.setTags([...next]);
  }

  /** The next save persists the removal. */
  protected remove(tag: string): void {
    this.session.setTags(this.tags().filter((t) => t !== tag));
  }
}
