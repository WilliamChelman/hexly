import { ChangeDetectionStrategy, Component, input, linkedSignal, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { WorldTheme, WorldThemeSource } from '@hexly/domain';
import { ButtonComponent, SelectComponent } from '@hexly/web-ui';

/**
 * Copy the Theme of another World the Owner owns (#376): a Theme authored once is carried into the
 * next World, rather than rebuilt anchor by anchor.
 *
 * The offer is the server's answer, never this component's (see `WorldsService.themeSources`). What
 * leaves here is a set of values: the copy is a duplicate, not a link (ADR-0076).
 */
@Component({
  selector: 'app-theme-copy',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ButtonComponent, SelectComponent],
  template: `
    <!-- Nothing at all until the offer is answered: a read that has not landed, or failed, is not the
         same fact as "you have no other themed World", and must not render as it. -->
    @if (sources(); as offer) {
      @if (offer.length) {
        <div class="copy">
          <select
            appSelect
            class="source"
            data-testid="theme-copy-source"
            [attr.aria-label]="'worldTheme.copyLabel' | transloco"
            (change)="selected.set($any($event.target).value)"
          >
            <!-- Marked on the option rather than as the select's own value binding, which is
                 evaluated before the options exist: that would agree with the signal only by the
                 accident of both starting at the first row. -->
            @for (source of offer; track source.id) {
              <option [value]="source.id" [selected]="source.id === selected()">{{ source.name }}</option>
            }
          </select>
          <button appButton size="sm" data-testid="theme-copy" (click)="copy()">
            {{ 'worldTheme.copy' | transloco }}
          </button>
        </div>
      } @else {
        <p class="empty" data-testid="theme-copy-empty">{{ 'worldTheme.copyEmpty' | transloco }}</p>
      }
    }
  `,
  styles: `
    @reference '#app-styles.css';
    .copy {
      @apply flex flex-wrap items-center gap-2;
    }
    .source {
      @apply min-w-48 flex-1 basis-48;
    }
    .empty {
      @apply text-xs text-ink-muted;
    }
  `,
})
export class ThemeCopyComponent {
  /**
   * The Worlds on offer, as the server decided them — this one and the unthemed already excluded.
   * `null` is *not yet answered*; empty is the answer "you have no other themed World".
   */
  readonly sources = input.required<readonly WorldThemeSource[] | null>();

  /** The copied Theme, for the panel to stage as its draft. */
  readonly copied = output<WorldTheme>();

  /** Which World the button would copy from; re-seeded to the first whenever the offer changes. */
  protected readonly selected = linkedSignal(() => this.sources()?.[0]?.id ?? '');

  protected copy(): void {
    const source = this.sources()?.find((one) => one.id === this.selected());
    if (source) this.copied.emit(source.theme);
  }
}
