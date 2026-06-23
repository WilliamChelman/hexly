import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A coordinate pill — the app's signature mono detail. Its own span, so it owns
 * its styles rather than borrowing a global `.coord` class. Projects its
 * content. See ADR-0007.
 *
 *   <app-coord>q 0 · r 0</app-coord>
 */
@Component({
  selector: 'app-coord',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  styles: `
    :host {
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      letter-spacing: 0.02em;
      color: var(--color-ink-muted);
      background: var(--color-surface-sunken);
      border: 1px solid var(--color-line);
      border-radius: var(--radius-sm);
      padding: 1px var(--spacing-2);
    }
  `,
})
export class Coord {}
