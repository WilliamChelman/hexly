import { inject, Pipe, PipeTransform } from '@angular/core';
import { LocaleService } from './locale.service';

/**
 * Renders an epoch-millis timestamp as a short date under the user's Format
 * Locale (ADR-0038), falling back to the UI Locale. Impure so dates already on
 * screen reformat when the language or Format Locale changes mid-view — the
 * format is derived from LocaleService/Transloco state, not the input, so a pure
 * pipe would keep the stale format until the view is rebuilt. The transform is a
 * single `toLocaleDateString`, and it only re-runs when its (OnPush) host is
 * change-detected, so the cost is negligible.
 */
@Pipe({ name: 'hexlyDate', pure: false })
export class HexlyDatePipe implements PipeTransform {
  private readonly locale = inject(LocaleService);

  transform(timestamp: number): string {
    return this.locale.formatDate(timestamp);
  }
}
