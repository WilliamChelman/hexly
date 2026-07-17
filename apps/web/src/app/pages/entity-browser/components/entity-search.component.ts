import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { IconComponent } from '@hexly/web-ui';

/**
 * The Entity browser's full-text search box (#154). Controlled: the parent owns
 * the query (debounce, URL mirror), passing it in as {@link value} and receiving
 * every raw keystroke via {@link search}. Presentation only — no debounce here.
 */
@Component({
  selector: 'app-entity-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, TranslocoPipe],
  host: { class: 'relative block mb-8' },
  template: `
    <app-icon
      name="label"
      [size]="18"
      class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
    />
    <input
      type="search"
      data-testid="entity-search"
      class="w-full pl-10 pr-3 py-2.5 font-sans text-md text-ink-strong bg-surface rounded-sm border border-line focus:border-gold outline-none placeholder:text-ink-faint"
      [value]="value()"
      [attr.aria-label]="'entityBrowser.searchLabel' | transloco"
      [attr.placeholder]="'entityBrowser.searchPlaceholder' | transloco"
      (input)="queryChange.emit($any($event.target).value)"
    />
  `,
})
export class EntitySearchComponent {
  /** The active query to display (the parent's debounced, URL-mirrored source of truth). */
  readonly value = input('');
  /** Every raw keystroke, undebounced — the parent debounces and commits it. */
  readonly queryChange = output<string>();
}
