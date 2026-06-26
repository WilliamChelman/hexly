import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { translateSignal, TranslocoPipe } from '@jsverse/transloco';
import { Chip } from '../../../ui/chip';
import { EntitySession } from '../services/entity-session';

/**
 * Free-text tag editor for the open Entity (CONTEXT.md → Tag, #72).
 * Version-checked Save (shared with Content) actually persists changes; type-agnostic across entity types.
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
   * Fires on Enter and blur (#88 — blur prevents losing a typed-but-not-confirmed tag when
   * the user clicks Save). Comma-splits for paste; trims, lower-cases, and deduplicates to
   * match server normalization immediately (entity.ts dedupedTags).
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

  /** The next save persists the removal. */
  protected remove(tag: string): void {
    this.session.setTags(this.tags().filter((t) => t !== tag));
  }
}
