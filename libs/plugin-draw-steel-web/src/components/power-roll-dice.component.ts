import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { IconButtonComponent, IconComponent } from '@hexly/web-ui';
import { DsTierKey, resolveTier } from '@hexly/plugin-draw-steel';
import { DICE_RNG, evaluate, formatRoll, parse } from '@hexly/dice-web';

/**
 * The read-view **Power Roll** roller (#252): a `dices` icon button that resolves a power roll ephemerally —
 * `2d10 + the ability's characteristic` (an absent score adds 0) — and shows the total + resolved tier in a
 * bubble anchored above the button (CSS-anchored to this host, no overlay primitive). The Roll is transient
 * (CONTEXT.md → Dice): nothing persists, and it {@link resolved}-emits the banded tier so the host can
 * highlight the matching tier row (or `null` on dismiss). Sticky until re-roll, explicit dismiss, or an
 * outside click.
 */
@Component({
  selector: 'ds-power-roll-dice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `relative` so the bubble anchors here; a click anywhere outside dismisses it (the button/bubble stop it).
  host: { class: 'relative inline-flex', '(document:click)': 'dismiss()' },
  imports: [TranslocoPipe, IconButtonComponent, IconComponent],
  template: `
    <button
      type="button"
      appIconButton
      size="sm"
      data-testid="ability-roll"
      [title]="'dice.rollAction' | transloco"
      [attr.aria-label]="'dice.rollAction' | transloco"
      (click)="roll($event)"
    >
      <app-icon name="dices" [size]="16" />
    </button>

    @if (result(); as state) {
      <div
        class="absolute bottom-full right-0 z-10 mb-1 w-max max-w-[16rem] rounded-md border border-line bg-surface p-2 text-left shadow-2"
        role="status"
        data-testid="ability-roll-bubble"
        (click)="$event.stopPropagation()"
      >
        <div class="flex items-center justify-between gap-3">
          <span class="text-2xs uppercase tracking-wider text-ink-muted">{{ 'dice.rollResult' | transloco }}</span>
          <button
            type="button"
            class="leading-none text-ink-muted hover:text-ink"
            data-testid="ability-roll-dismiss"
            [title]="'dice.dismiss' | transloco"
            [attr.aria-label]="'dice.dismiss' | transloco"
            (click)="dismiss($event)"
          >
            ✕
          </button>
        </div>
        <div class="mt-0.5 flex items-baseline gap-2">
          <span class="text-lg font-bold text-ink-strong" data-testid="ability-roll-total">{{ state.total }}</span>
          <span class="text-xs font-semibold text-sea" data-testid="ability-roll-tier">
            {{ 'drawSteel.statBlock.tier.' + state.tier | transloco }}
          </span>
        </div>
        <div class="mt-0.5 text-2xs text-ink-muted" data-testid="ability-roll-breakdown">{{ state.detail }}</div>
      </div>
    }
  `,
})
export class PowerRollDiceComponent {
  /** The characteristic score added to `2d10`; an absent value adds 0 (#252). */
  readonly modifier = input<number>(0);
  /** The banded tier while a Roll stands, or `null` once dismissed — the host highlights the matching row. */
  readonly resolved = output<DsTierKey | null>();

  /** Overridable RNG so a spec seeds the Roll (issue #249); production takes `Math.random`. */
  private readonly rng = inject(DICE_RNG);

  /** The last Roll resolved, if any — drives the bubble; a re-roll replaces it in one click. */
  protected readonly result = signal<PowerRollResult | null>(null);

  /**
   * Resolve the power roll: `2d10 + the modifier` (a negative one subtracts), banded to a Draw Steel tier.
   * The click stops here — it would otherwise bubble to {@link dismiss} and clear the bubble it just opened.
   */
  protected roll(event: Event): void {
    event.stopPropagation();
    const modifier = this.modifier();
    const expression = modifier < 0 ? `2d10 - ${-modifier}` : `2d10 + ${modifier}`;
    const ast = parse(expression);
    if (ast.isErr()) return;
    const rolled = evaluate(ast.value, this.rng);
    const tier = resolveTier(rolled.total);
    this.result.set({ total: rolled.total, tier, detail: formatRoll(expression, rolled).detail });
    this.resolved.emit(tier);
  }

  /** Dismiss the bubble — explicit (the ✕, with `event`) or an outside click (the document listener). */
  protected dismiss(event?: Event): void {
    event?.stopPropagation();
    if (!this.result()) return;
    this.result.set(null);
    this.resolved.emit(null);
  }
}

/** A resolved read-time Roll — the total, its banded tier, and the breakdown the bubble shows. */
interface PowerRollResult {
  readonly total: number;
  readonly tier: DsTierKey;
  readonly detail: string;
}
