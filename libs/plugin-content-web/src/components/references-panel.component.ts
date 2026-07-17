import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Eyebrow } from '@hexly/web-ui';
import { ReferencesStore } from '../services/references-store';
import { ReferenceRow } from './reference-row.component';

/**
 * The References panel (ADR-0046): the open Entity's own links (**References**) above the Entities
 * that link to it (**Referenced by**), read from the derived edge index.
 *
 * It hides nothing of its own. *Referenced by* arrives already filtered by the viewer's access to
 * each source; an outbound target the viewer cannot read (or that no longer exists) arrives as
 * `target: null`, which {@link ReferenceRow} renders as the non-navigable dangling label.
 *
 * Empty states are gated on `loaded()`: an in-flight fetch would otherwise show a false empty state.
 */
@Component({
  selector: 'app-references-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Eyebrow, ReferenceRow, TranslocoPipe],
  host: { class: 'flex flex-col gap-1 p-3 overflow-y-auto bg-surface' },
  template: `
    <span appEyebrow mark class="mb-1">{{ 'editor.links.references' | transloco }}</span>

    <!-- Tracked positionally: the list is replaced wholesale on each fetch and no row holds
         state, so identity buys nothing (as in the Outline). -->
    @for (ref of store.references(); track $index) {
      <app-reference-row data-testid="reference-out" [entity]="ref.target" [descriptor]="ref.descriptor" />
    } @empty {
      @if (store.loaded()) {
        <p class="text-sm leading-normal text-ink-muted" data-testid="references-out-empty">
          {{ 'editor.links.referencesEmpty' | transloco }}
        </p>
      }
    }

    <span appEyebrow mark class="mt-3 mb-1">{{ 'editor.links.referencedBy' | transloco }}</span>

    @for (ref of store.referencedBy(); track $index) {
      <app-reference-row data-testid="reference-in" [entity]="ref.source" [descriptor]="ref.descriptor" />
    } @empty {
      @if (store.loaded()) {
        <p class="text-sm leading-normal text-ink-muted" data-testid="references-in-empty">
          {{ 'editor.links.referencedByEmpty' | transloco }}
        </p>
      }
    }
  `,
})
export class ReferencesPanel {
  protected readonly store = inject(ReferencesStore);
}
