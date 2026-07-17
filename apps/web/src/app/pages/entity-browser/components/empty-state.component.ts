import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PanelComponent } from '@hexly/web-ui';

/**
 * A centered panel for a list's zero-row states — empty library, no search matches, load error.
 * The caller passes the already-translated title/hint. `display: contents` so the `<section>` sits
 * where the component is placed.
 */
@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PanelComponent],
  host: { class: 'contents' },
  template: `
    <section class="p-8 text-center text-ink-muted" [attr.data-testid]="testid()" appPanel>
      <p>{{ title() }}</p>
      <p class="text-sm">{{ hint() }}</p>
    </section>
  `,
})
export class EmptyStateComponent {
  /** Distinguishes the state in the DOM (`empty`, `no-matches`, `load-error`). */
  readonly testid = input.required<string>();
  readonly title = input.required<string>();
  readonly hint = input.required<string>();
}
