import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { DesignToken, ThemeWarning } from '@hexly/web-styles';

/**
 * What one ColorScheme's Palette costs a reader (ADR-0076): the pairs that fell below 4.5:1, an accent
 * no automatic foreground rescues, and any category tone that has rotated into a status colour.
 *
 * Advisory and never a gate — a deliberately oppressive Palette in a horror World is a legitimate
 * choice, so this warns and the Theme still saves. It says so out loud when a Palette is clear, because
 * a report that only ever appears is one an Owner cannot tell from a report that is not running.
 */
@Component({
  selector: 'app-theme-contrast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  template: `
    <div class="contrast" [attr.data-testid]="'theme-contrast-' + scheme()">
      @if (warnings().length === 0) {
        <p class="clear">{{ 'worldTheme.contrast.clear' | transloco }}</p>
      } @else {
        <ul class="warnings">
          @for (warning of warnings(); track key(warning)) {
            <li class="warning" [attr.data-testid]="'theme-warning-' + scheme() + '-' + key(warning)">
              {{ 'worldTheme.contrast.' + warning.kind | transloco: params(warning) }}
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    @reference '#app-styles.css';
    .contrast {
      @apply font-body text-2xs font-normal;
    }
    .clear {
      @apply m-0 text-ink-faint;
    }
    .warnings {
      @apply m-0 flex list-none flex-col gap-0.5 p-0;
    }
    .warning {
      @apply text-danger;
    }
  `,
})
export class ThemeContrastComponent {
  /** Which half of the Theme this reports on — including the one the author is not looking at. */
  readonly scheme = input.required<string>();
  readonly warnings = input.required<readonly ThemeWarning[]>();

  private readonly transloco = inject(TranslocoService);

  /**
   * A warning's identity, and its testid: what it is about rather than where it landed, so a spec can
   * name the pair it deliberately broke instead of counting rows.
   */
  protected key(warning: ThemeWarning): string {
    switch (warning.kind) {
      case 'contrast':
        return `contrast-${role(warning.ink)}-${role(warning.ground)}`;
      case 'midToneAccent':
        return 'midtone';
      case 'toneCollision':
        return `${role(warning.tone)}-${role(warning.against)}`;
    }
  }

  /**
   * The message's holes. Role names are translated here rather than spliced in the template: a sentence
   * assembled from spans has the word order English happens to use baked into it.
   */
  protected params(warning: ThemeWarning): Record<string, string> {
    const name = (token: DesignToken) => this.transloco.translate(`worldTheme.role.${role(token)}`);
    switch (warning.kind) {
      case 'contrast':
        return { ink: name(warning.ink), ground: name(warning.ground), ratio: warning.ratio.toFixed(2) };
      case 'midToneAccent':
        return { ratio: warning.ratio.toFixed(2) };
      case 'toneCollision':
        return { tone: name(warning.tone), status: name(warning.against), distance: warning.distance.toFixed(0) };
    }
  }
}

/** A role token's short name — `--color-ink-muted` → `ink-muted`, which is what the catalogs key on. */
function role(token: DesignToken): string {
  return token.replace('--color-', '');
}
