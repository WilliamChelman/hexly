import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ColorScheme } from '@hexly/web-core';
import { DesignToken, ThemeWarning } from '@hexly/web-styles';

/** One warning as the template needs it: what it is about, and the holes in the sentence about it. */
interface WarningLine {
  readonly key: string;
  readonly params: Record<string, string>;
}

/**
 * What one ColorScheme's Palette costs a reader (ADR-0076). Advisory, never a gate.
 *
 * Three states, not two: `null` is a report that could not be taken at all, and rendering it as "clear"
 * would be the one wrong answer a readability report can give.
 */
@Component({
  selector: 'app-theme-contrast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  template: `
    @if (warnings(); as warnings) {
      <div class="contrast" [attr.data-testid]="'theme-contrast-' + scheme()">
        @if (warnings.length === 0) {
          <p class="clear">{{ 'worldTheme.contrast.clear' | transloco }}</p>
        } @else {
          <ul class="warnings">
            @for (warning of warnings; track $index) {
              @let line = describe(warning);
              <li class="warning" [attr.data-testid]="'theme-warning-' + scheme() + '-' + line.key">
                {{ 'worldTheme.contrast.' + warning.kind | transloco: line.params }}
              </li>
            }
          </ul>
        }
      </div>
    }
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
  readonly scheme = input.required<ColorScheme>();
  readonly warnings = input.required<readonly ThemeWarning[] | null>();

  private readonly transloco = inject(TranslocoService);

  /**
   * A warning's identity and its copy in one pass. The key is what the warning is *about* rather than
   * where it landed, so a spec names the pair it deliberately broke instead of counting rows; the role
   * names are translated here rather than spliced in the template, where a sentence assembled from
   * spans would have English's word order baked into it.
   */
  protected describe(warning: ThemeWarning): WarningLine {
    const name = (token: DesignToken) => this.transloco.translate(`worldTheme.role.${role(token)}`);
    switch (warning.kind) {
      case 'contrast':
        return {
          key: `contrast-${role(warning.ink)}-${role(warning.ground)}`,
          params: { ink: name(warning.ink), ground: name(warning.ground), ratio: warning.ratio.toFixed(2) },
        };
      case 'midToneAccent':
        return { key: 'midtone', params: { ratio: warning.ratio.toFixed(2) } };
      case 'toneCollision':
        return {
          key: `${role(warning.tone)}-${role(warning.against)}`,
          params: { tone: name(warning.tone), status: name(warning.against), distance: warning.distance.toFixed(0) },
        };
    }
  }
}

/** A role token's short name — `--color-ink-muted` → `ink-muted`, which is what the catalogs key on. */
function role(token: DesignToken): string {
  return token.replace('--color-', '');
}
