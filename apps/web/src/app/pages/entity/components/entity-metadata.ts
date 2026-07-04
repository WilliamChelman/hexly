import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { EntitySession } from '../services/entity-session';

/**
 * Read-only view of the open Entity's Metadata map (CONTEXT.md → Metadata, ADR-0033):
 * the frontmatter keys and Hexly provenance (`hexly.sourcePath`) an import brought
 * across, so a worldbuilder can confirm what landed. A dev affordance — a collapsed
 * disclosure atop the note body — not an editor; editing Metadata is out of scope.
 * Renders nothing when the Entity carries no Metadata.
 */
@Component({
  selector: 'app-entity-metadata',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  template: `
    @if (entries().length > 0) {
      <details
        class="mb-4 rounded-md border border-line bg-surface-sunken"
        data-testid="entity-metadata"
      >
        <summary
          class="cursor-pointer select-none px-3 py-2 text-2xs uppercase tracking-wider text-ink-muted"
        >
          {{ 'entityMetadata.heading' | transloco }} ({{ entries().length }})
        </summary>
        <dl
          class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 border-t border-line px-3 py-2 m-0 text-sm"
        >
          @for (entry of entries(); track entry.key) {
            <dt class="font-mono text-xs text-ink-muted break-all">
              {{ entry.key }}
            </dt>
            <dd class="m-0 text-ink break-words">{{ entry.value }}</dd>
          }
        </dl>
      </details>
    }
  `,
})
export class EntityMetadata {
  private readonly session = inject(EntitySession);

  /** The open Entity's Metadata as displayable key/value rows; empty when there is none. */
  protected readonly entries = computed(() => {
    const metadata = this.session.current()?.document.metadata ?? {};
    return Object.entries(metadata).map(([key, value]) => ({
      key,
      value: display(value),
    }));
  });
}

/** Flatten a Metadata value to a string for read-only display (the domain never interprets it). */
function display(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(display).join(', ');
  return JSON.stringify(value) ?? '';
}
