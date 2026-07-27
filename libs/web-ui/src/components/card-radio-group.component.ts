import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A group of `app-card-radio`s. The consumer owns the label and the selection state; the group owns
 * the `radiogroup` role and the wrapping. See ADR-0007.
 *
 * Its own file, not beside the card: two `@Component`s carrying inline `styles` in one file resolve to
 * a single stylesheet, and the second one silently renders unstyled.
 *
 *   <div appCardRadioGroup [attr.aria-label]="'Corners' | transloco">
 *     <app-card-radio name="theme-radii" …>…</app-card-radio>
 *   </div>
 */
@Component({
  selector: '[appCardRadioGroup]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'radiogroup' },
  template: `<ng-content />`,
  styles: `
    @reference '#app-styles.css';

    :host {
      @apply flex flex-wrap gap-3;
    }
  `,
})
export class CardRadioGroupComponent {}
