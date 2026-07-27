import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { EyebrowComponent } from '@hexly/web-ui';
import { ReferencesStore } from '../services/references-store';
import { ReferenceRowComponent } from './reference-row.component';

/**
 * The **References Panel** (ADR-0046) — the first universal Panel of the page's Dock (ADR-0067),
 * present on every View: the open Entity's own links (**References**) above the Entities that link to
 * it (**Referenced by**), read from the derived edge index.
 *
 * It owns its {@link ReferencesStore} in `providers`, so the store lives and dies with the open Panel:
 * opening it fetches, closing it drops the fetch, and reopening refetches.
 *
 * The two sections split relation from usage (ADR-0069). **References** (outbound) is a *relation*
 * surface: it hides Decor Links — a Thumbnail designation, a prose image — by default behind an
 * ephemeral reveal, so "what does this Entity relate to" isn't answered with its cover art. **Referenced
 * by** (inbound) is the *usage* surface: it shows every edge unconditionally, decor visually marked, so
 * an Asset's usage list (and the delete confirmation it feeds) counts everything that displays it.
 *
 * *Referenced by* arrives already filtered by the viewer's access to each source; an outbound target the
 * viewer cannot read (or that no longer exists) arrives as `target: null`, which
 * {@link ReferenceRowComponent} renders as the non-navigable dangling label.
 *
 * Empty states are gated on `loaded()`: an in-flight fetch would otherwise show a false empty state.
 */
@Component({
  selector: 'app-references-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ReferencesStore],
  imports: [EyebrowComponent, ReferenceRowComponent, TranslocoPipe],
  host: { class: 'flex flex-col gap-1 p-3 overflow-y-auto bg-surface min-h-0 flex-1' },
  template: `
    <div class="mb-1 flex items-center justify-between gap-2">
      <span appEyebrow mark>{{ 'fields.links.references' | transloco }}</span>
      <!-- The reveal renders only when there is decor to show, so it is never dead chrome. Ephemeral
           and default-hidden (ADR-0069): a peek at the presentation wiring, not a sticky mode. -->
      @if (store.hasDecorReferences()) {
        <button
          type="button"
          [attr.aria-pressed]="store.revealDecor()"
          class="font-sans text-xs text-ink-muted px-1.5 py-0.5 rounded-sm hover:bg-surface-sunken aria-pressed:bg-accent/15 aria-pressed:text-accent-strong"
          data-testid="references-decor-toggle"
          (click)="store.toggleRevealDecor()"
        >
          {{ 'fields.links.showDecor' | transloco }}
        </button>
      }
    </div>

    <!-- Tracked positionally: the list is replaced wholesale on each fetch and no row holds
         state, so identity buys nothing (as in the Outline). -->
    @for (ref of store.visibleReferences(); track $index) {
      <app-reference-row
        data-testid="reference-out"
        [entity]="ref.target"
        [descriptor]="ref.descriptor"
        [decor]="ref.decor"
      />
    } @empty {
      @if (store.loaded()) {
        <p class="text-sm leading-normal text-ink-muted" data-testid="references-out-empty">
          {{ 'fields.links.referencesEmpty' | transloco }}
        </p>
      }
    }

    <span appEyebrow mark class="mt-3 mb-1">{{ 'fields.links.referencedBy' | transloco }}</span>

    @for (ref of store.referencedBy(); track $index) {
      <app-reference-row
        data-testid="reference-in"
        [entity]="ref.source"
        [descriptor]="ref.descriptor"
        [decor]="ref.decor"
      />
    } @empty {
      @if (store.loaded()) {
        <p class="text-sm leading-normal text-ink-muted" data-testid="references-in-empty">
          {{ 'fields.links.referencedByEmpty' | transloco }}
        </p>
      }
    }
  `,
})
export class ReferencesPanelComponent {
  protected readonly store = inject(ReferencesStore);
}
