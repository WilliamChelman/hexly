import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A keycap — renders a `<kbd>` with the app's mono keycap styling. Projects its
 * content. See ADR-0007.
 *
 *   <kbd appKbd>⌘ Z</kbd>
 */
@Component({
  selector: 'kbd[appKbd]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  styles: `
    :host {
      font-family: var(--font-mono);
      font-size: var(--text-2xs);
      padding: 1px var(--space-2);
      color: var(--ink-muted);
      background: var(--surface-raised);
      border: 1px solid var(--line-strong);
      border-bottom-width: 2px;
      border-radius: var(--radius-sm);
    }
  `,
})
export class Kbd {}
