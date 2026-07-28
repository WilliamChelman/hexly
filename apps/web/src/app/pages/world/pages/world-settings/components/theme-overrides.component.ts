import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ColorScheme, ThemeDeclarationSet } from '@hexly/web-core';
import { ButtonComponent } from '@hexly/web-ui';
import { colorTokenHex } from '@hexly/domain';
import { TokenDerivation } from '@hexly/web-styles';
import {
  COLOR_SCHEMES,
  OVERRIDE_GROUPS,
  OverrideControl,
  OverrideGroup,
  SchemeEdit,
  ThemeOverrides,
  overrideSeed,
  overrideValue,
  resolvedRoles,
  roleDerivations,
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
 * A row is either untouched or overridden, never "overridden at the derived value": a colour well opened
 * at black would claim the token *is* black. An untouched row therefore shows what the token currently
 * resolves to and nothing about where that came from — see {@link resolvedRoles}.
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
                 translation, and a second vocabulary beside the manifest is a second thing to drift.
                 Under it, where the value comes from — the stylesheet's own declaration, marked and
                 then shown, so "derived" is a claim the row can back rather than one it just makes. -->
            <div class="row-label">
              <code class="row-name">{{ control.token }}</code>
              @let from = derivationOf(control);
              @if (from) {
                <span class="derivation">
                  <span class="mark" [attr.data-testid]="'theme-derivation-' + control.slug">
                    {{ 'worldTheme.derivation.' + from.kind | transloco }}
                  </span>
                  <!-- The expression is pure CSS, so it is shown as written; the full text is the
                       title, since a fold on every row would be a wall the mark exists to avoid. -->
                  @if (formula(from); as text) {
                    <code class="formula" [attr.title]="from.formula">{{ text }}</code>
                  }
                </span>
              }
            </div>
            @for (scheme of schemes; track scheme) {
              @let value = valueFor(scheme, control);
              <!-- The row's token name is shared by both cells, so each control names its own. -->
              @let name = control.token + ' — ' + ('common.colorScheme.' + scheme | transloco);
              <div class="cell">
                @if (value === undefined) {
                  @let current = resolvedFor(scheme, control);
                  <button
                    appButton
                    variant="ghost"
                    size="sm"
                    class="current"
                    [attr.data-testid]="'theme-override-set-' + scheme + '-' + control.slug"
                    [attr.aria-label]="'worldTheme.setOverride' | transloco: { name, value: current }"
                    (click)="changed.emit({ scheme, control, raw: seed(control, current) })"
                  >
                    <!-- The value the row currently renders as, in the medium it renders in: a swatch for
                         a colour, a chip wearing the elevation for one of those. A translucent role
                         shows the panel through it, which the hex beside it cannot — the readout is
                         lossy in the one direction the colour well is, as its hex helper says. -->
                    @switch (medium(control)) {
                      @case ('swatch') {
                        <span class="swatch"><span class="swatch-fill" [style.background]="current"></span></span>
                        <span class="readout">{{ hex(current) }}</span>
                      }
                      @case ('elevation') {
                        <!-- On its own ColorScheme's paper, not the panel's. An elevation is only
                             ever the contrast it makes with what it falls on, and Astral's is
                             near-black soot at four times Solar's alpha: over this panel's ivory it
                             reads as a bruise, and over the indigo it will sit on, as depth. -->
                        <span class="elevation-plate" [style.background]="ground(scheme)">
                          <span
                            class="elevation-chip"
                            [style.background]="raised(scheme)"
                            [style.boxShadow]="current"
                          ></span>
                        </span>
                      }
                      @default {
                        <span class="readout">{{ current }}</span>
                      }
                    }
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
      /* The scheme columns hold an elevation plate at its widest — 9rem, so it is never squeezed. */
      grid-template-columns: minmax(20rem, 2.4fr) minmax(9rem, 1fr) minmax(9rem, 1fr);
    }
    .scheme-head {
      @apply pb-1 font-display text-sm text-ink-strong;
    }
    .row-label {
      @apply flex min-w-0 flex-col gap-0.5;
    }
    .row-name {
      @apply truncate font-mono text-2xs text-ink-muted;
    }
    .derivation {
      @apply flex min-w-0 items-baseline gap-1.5;
    }
    .mark {
      @apply flex-none rounded-full bg-surface-sunken px-1.5 py-px text-2xs text-ink-faint;
    }
    /* Two lines, then the title: a derivation is ~110 characters at its longest, which wraps to two
       here and to a wall of five if every one of ~50 rows is let run. */
    .formula {
      @apply min-w-0 font-mono text-2xs leading-snug text-ink-faint;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
      /* Breaks at the expression's own brackets rather than mid-token, as break-all would. */
      overflow-wrap: anywhere;
    }
    .cell {
      @apply flex min-w-0 items-center gap-1;
    }
    .control {
      @apply min-w-0 flex-1;
    }
    .current {
      @apply min-w-0 flex-1 justify-start gap-2;
    }
    /* A chequer under the fill, so a translucent role reads as translucent rather than as a pale
       colour: the hex beside it is the colour, and is the one thing that cannot carry the alpha. */
    .swatch {
      @apply h-5 w-5 flex-none overflow-hidden rounded-sm border border-line-faint bg-surface-raised;
      background-image: conic-gradient(
        var(--color-surface-sunken) 0 25%,
        transparent 0 50%,
        var(--color-surface-sunken) 0 75%,
        transparent 0
      );
      background-size: 0.5rem 0.5rem;
    }
    .swatch-fill {
      @apply block h-full w-full;
    }
    /* Room for the whole fall. Astral's shadow-3 travels 22px down, blurs 50px and pulls 11px back, so
       it reaches ~36px below the chip and ~14px to each side; a plate cropped tighter than that spills
       the tail onto the panel's own paper, which is the comparison this plate exists to end. Asymmetric
       for the same reason the shadow is: nothing reaches above. */
    .elevation-plate {
      @apply flex flex-none items-center justify-center rounded-sm px-5 pt-4 pb-10;
    }
    /* Card-sized, because below ~80×48 the ladder *inverts*: shadow-3 pulls its spread 8px in and then
       blurs 36px, so on a chip whose short side is 24px there is almost nothing left to blur and it
       lands fainter than shadow-1 (measured peak darkening 16 → 23 → 8 of 255 in Solar, 3 → 5 → 1 in
       Astral). At 96×60 it is at the plateau — 16 → 23 → 42 and 3 → 5 → 10, the same reading a
       320×180 card gives. The elevation ladder is scaled for the cards that wear it, and a swatch
       small enough to misreport it is a swatch that misreports it. */
    .elevation-chip {
      @apply h-15 w-24 flex-none rounded-md;
    }
    .readout {
      @apply truncate font-mono text-2xs tabular-nums text-ink-muted;
    }
  `,
})
export class ThemeOverridesComponent {
  /** The draft's opt-outs; `undefined` for a Theme that has none — every role follows the Palette. */
  readonly overrides = input<ThemeOverrides>();

  /** The whole chain the preview paints by, which is what an untouched row has to be measured over. */
  readonly declarations = input.required<ThemeDeclarationSet>();

  readonly changed = output<OverrideEdit>();

  protected readonly groups = OVERRIDE_GROUPS;
  protected readonly schemes = COLOR_SCHEMES;

  /**
   * What each row renders as right now, both ColorSchemes at once. A `computed` may do this for the
   * reason the contrast report may: `measureScheme` clears what is inline, reads, and restores the root
   * in a `finally`, all inside one task — so it is a function of its declarations and the stylesheets.
   */
  private readonly resolved = computed(() => resolvedRoles(this.declarations()));

  /** Read once for the whole grid: the stylesheets are fixed, and the walk is over every rule. */
  private readonly derivations = roleDerivations();

  protected resolvedFor(scheme: ColorScheme, control: OverrideControl): string {
    return this.resolved()[scheme][control.token] ?? '';
  }

  /**
   * The paper an elevation preview falls on, and the card it lifts — that ColorScheme's own, measured
   * with every other row (see {@link resolvedRoles}) rather than by re-dressing a subtree: the tier-2
   * roles are declared once at `:root`, so a nested `[data-color-scheme]` re-resolves the *Palette* and
   * inherits the reader's roles regardless (ADR-0076).
   */
  protected ground(scheme: ColorScheme): string {
    return this.resolved()[scheme]['--color-bg'] ?? '';
  }

  protected raised(scheme: ColorScheme): string {
    return this.resolved()[scheme]['--color-surface-raised'] ?? '';
  }

  protected derivationOf(control: OverrideControl): TokenDerivation | undefined {
    return this.derivations[control.token];
  }

  /**
   * What the mark is followed by: the expression for a derivation, the one token an alias renames, and
   * nothing for a literal — the swatch beside it already *is* the value, so restating it says nothing.
   */
  protected formula(from: TokenDerivation): string {
    if (from.kind === 'derived') return from.formula;
    return from.kind === 'anchor' ? (from.sources[0] ?? '') : '';
  }

  /**
   * How an untouched row shows its value, off the token's declared type (ADR-0075) — never its name, as
   * in {@link ThemeControlComponent}. Named rather than switched on the type in the template because
   * `no-builtin-shadow` reads a template's every word as a class name, and the type is one of its own.
   */
  protected medium(control: OverrideControl): 'swatch' | 'elevation' | 'text' {
    if (control.type === 'color') return 'swatch';
    return control.type === 'shadow' ? 'elevation' : 'text';
  }

  /** The readout beside a swatch; the resolved value itself where it is no colour a hex can hold. */
  protected hex(resolved: string): string {
    return colorTokenHex(resolved) ?? resolved;
  }

  protected seed(control: OverrideControl, resolved: string): string {
    return overrideSeed(control, resolved);
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
