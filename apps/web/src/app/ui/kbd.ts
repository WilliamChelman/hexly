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
  host: {
    class:
      'font-mono text-2xs py-[1px] px-2 text-ink-muted bg-surface-raised border border-line-strong border-b-2 rounded-sm',
  },
  template: '<ng-content />',
})
export class Kbd {}
