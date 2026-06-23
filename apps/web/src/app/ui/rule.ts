import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A hairline divider drawn like a map rule (a faint inner edge). Renders an
 * `<hr>`. See ADR-0007.
 *
 *   <hr appRule />
 */
@Component({
  selector: 'hr[appRule]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  styles: `
    :host {
      height: 0;
      border: 0;
      border-top: 1px solid var(--color-line);
      box-shadow: 0 1px 0 var(--color-line-faint);
    }
  `,
})
export class Rule {}
