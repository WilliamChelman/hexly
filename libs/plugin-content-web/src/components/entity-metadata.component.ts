import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { isStructuredDataType } from '@hexly/domain';
import { ENTITY_SESSION, ENTITY_TYPES } from '@hexly/web-entity';

/**
 * Read-only view of the open Entity's EntityDocument map (CONTEXT.md → EntityDocument, ADR-0033): the
 * frontmatter keys and Hexly provenance (`hexly.sourcePath`) an import brought across. Read-only,
 * not an editor. Renders nothing when the Entity carries no EntityDocument.
 *
 * A **Structured Data Type**'s value is skipped (ADR-0050): it is a document with its own View.
 */
@Component({
  selector: 'app-entity-metadata',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  template: `
    @if (entries().length > 0) {
      <details class="mb-4 rounded-md border border-line bg-surface-sunken" data-testid="entity-metadata">
        <summary class="cursor-pointer select-none px-3 py-2 text-2xs uppercase tracking-wider text-ink-muted">
          {{ 'editor.metadata.heading' | transloco }} ({{ entries().length }})
        </summary>
        <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 border-t border-line px-3 py-2 m-0 text-sm">
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
export class EntityMetadataComponent {
  private readonly session = inject(ENTITY_SESSION);
  private readonly types = inject(ENTITY_TYPES);

  /**
   * The EntityDocument keys a Structured Data Type types — a document, shown on its own View, never here.
   * Over the effective set, with attachments derived from the document's own keys (ADR-0054/ADR-0057):
   * passing every document key as an attachment candidate resolves the extras and drops foreign bare keys.
   */
  private readonly structuredKeys = computed(
    () =>
      new Set(
        this.types
          .effectiveFields(this.session.current()?.types, Object.keys(this.session.current()?.document ?? {}))
          .filter((field) => isStructuredDataType(field.dataType))
          .map((field) => field.id),
      ),
  );

  /** The open Entity's EntityDocument as displayable key/value rows; empty when there is none. */
  protected readonly entries = computed(() => {
    const metadata = this.session.current()?.document ?? {};
    const structured = this.structuredKeys();
    return Object.entries(metadata)
      .filter(([key]) => !structured.has(key))
      .map(([key, value]) => ({
        key,
        value: display(value),
      }));
  });
}

/** Flatten a EntityDocument value to a string for read-only display (the domain never interprets it). */
function display(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(display).join(', ');
  return JSON.stringify(value) ?? '';
}
