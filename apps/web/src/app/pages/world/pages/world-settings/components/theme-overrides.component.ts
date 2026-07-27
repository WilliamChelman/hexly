import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ColorScheme, ColorSchemeService } from '@hexly/web-core';
import { ButtonComponent } from '@hexly/web-ui';
import {
  COLOR_SCHEMES,
  OVERRIDE_GROUPS,
  OverrideControl,
  OverrideGroup,
  SchemeEdit,
  ThemeOverrides,
  overrideSeed,
  overrideValue,
} from '../utils/theme-draft';
import { ThemeControlComponent } from './theme-control.component';

/** One override moved: which ColorScheme, which public token, and what it now holds — `null` to clear. */
export type OverrideEdit = SchemeEdit<OverrideControl, string | null>;

/**
 * The tier-2 opt-outs an Owner may author (ADR-0076, #374): a row per public role, a column per
 * ColorScheme, so the derivation is a starting point rather than a cage.
 *
 * The rows are the list the write choke point keys its schema on, so no private anchor or plugin token
 * is reachable (ADR-0075). ~50 rows in declaration order is a wall, hence a collapsed block per role
 * family, each summary counting its own overrides.
 *
 * A row is either derived or overridden, never "overridden at the derived value": a colour well opened
 * at black would claim the token *is* black.
 */
@Component({
  selector: 'app-theme-overrides',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, ButtonComponent, ThemeControlComponent],
  template: `
    @for (group of groups; track group.id) {
      @let overridden = count(group);
      <details class="group" [attr.data-testid]="'theme-override-group-' + group.id">
        <summary class="summary">
          <span class="group-name">{{ 'worldTheme.overrideGroup.' + group.id | transloco }}</span>
          @if (overridden > 0) {
            <span class="badge" [attr.data-testid]="'theme-override-count-' + group.id">
              {{ 'worldTheme.overriddenCount' | transloco: { count: overridden } }}
            </span>
          }
        </summary>

        <div class="grid">
          <!-- The header row's empty first cell: the token-name column has no heading of its own. -->
          <span aria-hidden="true"></span>
          @for (scheme of schemes; track scheme) {
            <div class="scheme-head">{{ 'common.colorScheme.' + scheme | transloco }}</div>
          }

          @for (control of group.controls; track control.token) {
            <!-- The token's own name is the label: it is what the Owner sees in devtools, it needs no
                 translation, and a second vocabulary beside the manifest is a second thing to drift. -->
            <code class="row-name">{{ control.token }}</code>
            @for (scheme of schemes; track scheme) {
              @let value = valueFor(scheme, control);
              <!-- The row's token name is shared by both cells, so each control names its own. -->
              @let name = control.token + ' — ' + ('common.colorScheme.' + scheme | transloco);
              <div class="cell">
                @if (value === undefined) {
                  <button
                    appButton
                    variant="ghost"
                    size="sm"
                    [attr.data-testid]="'theme-override-set-' + scheme + '-' + control.slug"
                    [attr.aria-label]="'worldTheme.setOverride' | transloco: { name }"
                    (click)="changed.emit({ scheme, control, raw: seed(control, scheme) })"
                  >
                    {{ 'worldTheme.derived' | transloco }}
                  </button>
                } @else {
                  <app-theme-control
                    class="control"
                    [control]="control"
                    [value]="value"
                    [label]="'worldTheme.overrideOf' | transloco: { name }"
                    [testid]="'theme-override-' + scheme + '-' + control.slug"
                    (changed)="changed.emit({ scheme, control, raw: $event })"
                  />
                  <button
                    appButton
                    variant="ghost"
                    size="sm"
                    icon
                    [attr.data-testid]="'theme-override-clear-' + scheme + '-' + control.slug"
                    [attr.aria-label]="'worldTheme.clearOverride' | transloco: { name }"
                    (click)="changed.emit({ scheme, control, raw: null })"
                  >
                    ✕
                  </button>
                }
              </div>
            }
          }
        </div>
      </details>
    }
  `,
  styles: `
    @reference '#app-styles.css';
    :host {
      @apply flex flex-col gap-1;
    }
    .summary {
      @apply flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-strong;
      @apply hover:bg-surface-sunken;
      /* A flex summary drops its ::marker, and a row of role names with no affordance reads as prose. */
      list-style: none;
    }
    .summary::-webkit-details-marker {
      display: none;
    }
    .summary::before {
      content: '›';
      @apply inline-block w-3 text-center text-ink-faint;
      transition: transform var(--dur-fast) var(--ease-out);
    }
    details[open] > .summary::before {
      transform: rotate(90deg);
    }
    .group-name {
      @apply font-display;
    }
    .badge {
      @apply rounded-full bg-accent-soft px-2 py-0.5 text-2xs text-ink-muted;
    }
    .grid {
      @apply grid items-center gap-x-4 gap-y-2 py-2 pl-4;
      grid-template-columns: minmax(11rem, 1fr) minmax(8rem, 1fr) minmax(8rem, 1fr);
    }
    .scheme-head {
      @apply pb-1 font-display text-sm text-ink-strong;
    }
    .row-name {
      @apply truncate font-mono text-2xs text-ink-muted;
    }
    .cell {
      @apply flex min-w-0 items-center gap-1;
    }
    .control {
      @apply min-w-0 flex-1;
    }
  `,
})
export class ThemeOverridesComponent {
  /** The draft's opt-outs; `undefined` for a Theme that has none — every role is derived. */
  readonly overrides = input<ThemeOverrides>();

  readonly changed = output<OverrideEdit>();

  private readonly colorScheme = inject(ColorSchemeService);

  protected readonly groups = OVERRIDE_GROUPS;
  protected readonly schemes = COLOR_SCHEMES;

  /** Only the reader's own ColorScheme is the one the document has resolved — see {@link overrideSeed}. */
  protected seed(control: OverrideControl, scheme: ColorScheme): string {
    return overrideSeed(control, scheme === this.colorScheme.colorScheme());
  }

  protected valueFor(scheme: ColorScheme, control: OverrideControl): string | undefined {
    return overrideValue(this.overrides(), scheme, control);
  }

  /** How many of a group's rows are overridden, in either ColorScheme — the summary's own signal. */
  protected count(group: OverrideGroup): number {
    return group.controls.reduce(
      (total, control) => total + this.schemes.filter((scheme) => this.valueFor(scheme, control) !== undefined).length,
      0,
    );
  }
}
