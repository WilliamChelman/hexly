import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
} from '@angular/core';

/** Emphasis of a button — how loudly it asks to be pressed. */
export type ButtonVariant = 'default' | 'primary' | 'ghost';
export type ButtonSize = 'md' | 'sm';

/**
 * Turns a native `<button>`/`<a>` into a Hexly button by mapping typed inputs
 * onto its own scoped, token-driven styles. It uses an attribute selector on the
 * native element, so the real element keeps its type, focus, form participation
 * and a11y — and `<ng-content/>` projects its children — while the component
 * owns its visual definition. See ADR-0007.
 *
 *   <button appButton variant="primary" size="sm">Share</button>
 *   <a appButton variant="ghost" routerLink="/styleguide">Design system</a>
 */
@Component({
  selector: 'button[appButton], a[appButton]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-primary]': "variant() === 'primary'",
    '[class.is-ghost]': "variant() === 'ghost'",
    '[class.is-sm]': "size() === 'sm'",
    '[class.is-icon]': 'icon()',
    '[class.is-danger]': 'danger()',
    '[class.is-active]': 'active()',
  },
  template: `<ng-content />`,
  styles: `
    :host {
      --_fg: var(--color-ink);
      --_bg: var(--color-surface-raised);
      --_bd: var(--color-line-strong);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-4);
      font-family: var(--font-body);
      font-size: var(--text-sm);
      font-weight: var(--font-weight-semibold);
      letter-spacing: 0.01em;
      color: var(--_fg);
      background: var(--_bg);
      border: 1px solid var(--_bd);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-1);
      cursor: pointer;
      white-space: nowrap;
      transition:
        transform var(--dur-fast) var(--ease-spring),
        background-color var(--dur-fast) var(--ease-out),
        border-color var(--dur-fast) var(--ease-out),
        box-shadow var(--dur-fast) var(--ease-out),
        color var(--dur-fast) var(--ease-out);
    }
    :host(:hover) {
      transform: translateY(-1px);
      box-shadow: var(--shadow-2);
      border-color: var(--color-gold);
    }
    :host(:active) {
      transform: translateY(0);
      box-shadow: var(--shadow-inset);
    }
    :host(:disabled),
    :host([aria-disabled='true']) {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    /* Gilded — gradient fill, gold glow, inset top-highlight; glow grows on hover. */
    :host(.is-primary) {
      --_fg: var(--color-on-gilded);
      background: var(--gradient-gold);
      border-color: color-mix(in srgb, var(--color-gold-bright) 70%, #fff);
      box-shadow:
        0 0 16px -2px var(--color-glow),
        inset 0 1px 0 rgba(255, 255, 255, 0.5);
    }
    :host(.is-primary:hover) {
      background: var(--gradient-gold);
      border-color: color-mix(in srgb, var(--color-gold-bright) 80%, #fff);
      box-shadow:
        0 0 24px -2px var(--color-glow),
        inset 0 1px 0 rgba(255, 255, 255, 0.55);
    }
    :host(.is-ghost) {
      --_bg: transparent;
      --_bd: transparent;
      box-shadow: none;
    }
    :host(.is-ghost:hover) {
      --_bg: var(--color-gold-soft);
      border-color: transparent;
      box-shadow: none;
    }
    :host(.is-danger) {
      --_fg: var(--color-ember);
      --_bd: color-mix(in oklab, var(--color-ember) 40%, var(--color-line));
    }
    :host(.is-danger:hover) {
      --_fg: var(--color-on-gold);
      --_bg: var(--color-ember);
      border-color: var(--color-ember);
    }
    /* Selected/pressed — a sticky highlight for a button acting as a toggle or a
       segmented choice (the consumer drives it via [active] and owns aria-pressed).
       Composes over any variant; placed last so it wins the same-specificity tie. */
    :host(.is-active) {
      --_fg: var(--color-ink-strong);
      --_bg: var(--color-gold-soft);
    }
    :host(.is-sm) {
      padding: var(--spacing-1) var(--spacing-3);
      font-size: var(--text-xs);
    }
    :host(.is-icon) {
      padding: var(--spacing-2);
      aspect-ratio: 1;
    }
  `,
})
export class Button {
  readonly variant = input<ButtonVariant>('default');
  readonly size = input<ButtonSize>('md');
  /** Square, padding-only button sized for a single glyph. */
  readonly icon = input(false, { transform: booleanAttribute });
  /** Destructive tone; composes with any variant. */
  readonly danger = input(false, { transform: booleanAttribute });
  /**
   * Selected/pressed highlight for a toggle or segmented choice. The consumer
   * sets this and owns the matching `aria-pressed`/`aria-current` — this only
   * paints the sticky highlight (gold-soft fill, ink-strong text).
   */
  readonly active = input(false, { transform: booleanAttribute });
}
