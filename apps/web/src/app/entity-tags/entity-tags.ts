import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { translateSignal, TranslocoPipe } from '@jsverse/transloco';
import { Chip } from '../ui/chip';
import { EntitySession } from '../editor-shell/entity-session';

/**
 * Add and remove an Entity's free-text Tags (CONTEXT.md → Tag, #72). Reads and
 * writes the open Entity's live tags through {@link EntitySession}; the version-
 * checked Save (shared with Content) is what actually persists them. Type-agnostic:
 * the same surface serves a `note` and a `hexmap`.
 */
@Component({
  selector: 'app-entity-tags',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Chip, TranslocoPipe],
  template: `
    <div class="flex flex-wrap items-center gap-2" data-testid="entity-tags">
      @for (tag of tags(); track tag) {
        <app-chip>
          {{ tag }}
          <button
            type="button"
            class="-mr-1 leading-none opacity-70 hover:opacity-100 cursor-pointer bg-transparent border-0 text-current"
            [attr.aria-label]="'entityTags.removeLabel' | transloco: { tag }"
            [attr.data-testid]="'tag-remove-' + tag"
            (click)="remove(tag)"
          >
            &times;
          </button>
        </app-chip>
      }
      <input
        type="text"
        data-testid="tag-input"
        class="min-w-32 flex-1 bg-transparent border-0 text-sm text-ink outline-none placeholder:text-ink-muted"
        [attr.aria-label]="addLabel()"
        [attr.placeholder]="addPlaceholder()"
        (keydown.enter)="add($event)"
        (blur)="add($event)"
      />
    </div>
  `,
})
export class EntityTags {
  private readonly session = inject(EntitySession);
  protected readonly tags = this.session.tags;
  protected readonly addLabel = translateSignal('entityTags.addLabel');
  protected readonly addPlaceholder = translateSignal('entityTags.addPlaceholder');

  /**
   * Add the typed entry to the live set — on Enter, and on blur so a tag typed
   * but not Enter-confirmed isn't lost when the user clicks Save (#88). Splits on
   * commas so a comma-separated paste adds several at once; trims, lower-cases and
   * skips duplicates to match the server's normalization (entity.ts dedupedTags)
   * immediately. Clears the field on success.
   */
  protected add(event: Event): void {
    const input = event.target as HTMLInputElement;
    const incoming = input.value
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const next = [...this.tags()];
    for (const tag of incoming) if (!next.includes(tag)) next.push(tag);
    if (next.length !== this.tags().length) this.session.setTags(next);
    input.value = '';
  }

  /** Drop a tag from the live set; the next save persists the removal. */
  protected remove(tag: string): void {
    this.session.setTags(this.tags().filter((t) => t !== tag));
  }
}
