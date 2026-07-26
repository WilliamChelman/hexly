import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

/** Emphasis of a button — how loudly it asks to be pressed. */
export type ButtonVariant = 'default' | 'primary' | 'ghost';
export type ButtonSize = 'md' | 'sm';

/**
 * Turns a native `<button>`/`<a>` into a Hexly button. The attribute selector keeps
 * the real element, so its type, focus, form participation and a11y survive (ADR-0007).
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
    /* @apply needs the theme in scope; reference the global sheet via the
       depth-invariant '#app-styles.css' subpath import (package.json). */
    @reference '#app-styles.css';

    :host {
      --_fg: var(--color-ink);
      --_bg: var(--color-surface-raised);
      --_bd: var(--color-line-strong);
      /* private-var consumption converts via v4 functional shorthand:
         text-(--_fg) / bg-(--_bg) / border-(--_bd). */
      @apply inline-flex items-center justify-center gap-2 px-4 py-2 font-body
        text-sm font-semibold tracking-[0.01em] rounded-md shadow-1 cursor-pointer
        whitespace-nowrap text-(--_fg) bg-(--_bg) border border-(--_bd);
      /* only the custom multi-prop transition on the motion tokens
         (--dur-… / --ease-…) has no utility form and stays raw. */
      transition:
        transform var(--dur-fast) var(--ease-spring),
        background-color var(--dur-fast) var(--ease-out),
        border-color var(--dur-fast) var(--ease-out),
        box-shadow var(--dur-fast) var(--ease-out),
        color var(--dur-fast) var(--ease-out);
    }
    :host(:hover) {
      @apply -translate-y-px shadow-2 border-accent;
    }
    :host(:active) {
      @apply translate-y-0 shadow-inset;
    }
    :host(:disabled),
    :host([aria-disabled='true']) {
      @apply opacity-50 cursor-not-allowed transform-none shadow-none;
    }

    /* The accent sheen — gradient fill, accent glow, inset top-highlight; glow grows on hover.
       Fully raw: gradient, color-mix border, layered glow box-shadow — no utilities. */
    :host(.is-primary) {
      --_fg: var(--color-on-accent-sheen);
      background: var(--gradient-accent-sheen);
      border-color: color-mix(in srgb, var(--color-accent-sheen-bright) 70%, #fff);
      box-shadow:
        0 0 16px -2px var(--color-accent-glow),
        inset 0 1px 0 rgba(255, 255, 255, 0.5);
    }
    :host(.is-primary:hover) {
      background: var(--gradient-accent-sheen);
      border-color: color-mix(in srgb, var(--color-accent-sheen-bright) 80%, #fff);
      box-shadow:
        0 0 24px -2px var(--color-accent-glow),
        inset 0 1px 0 rgba(255, 255, 255, 0.55);
    }
    :host(.is-ghost) {
      --_bg: transparent;
      --_bd: transparent;
      @apply shadow-none;
    }
    :host(.is-ghost:hover) {
      --_bg: var(--color-accent-soft);
      border-color: transparent;
      @apply shadow-none;
    }
    :host(.is-danger) {
      --_fg: var(--color-danger);
      --_bd: color-mix(in oklab, var(--color-danger) 40%, var(--color-line));
    }
    :host(.is-danger:hover) {
      --_fg: var(--color-on-fill);
      --_bg: var(--color-danger);
      border-color: var(--color-danger);
    }
    /* Selected/pressed — a sticky highlight for a button acting as a toggle or a
       segmented choice (the consumer drives it via [active] and owns aria-pressed).
       Composes over any variant; placed last so it wins the same-specificity tie. */
    :host(.is-active) {
      --_fg: var(--color-ink-strong);
      --_bg: var(--color-accent-soft);
    }
    :host(.is-sm) {
      @apply px-3 py-1 text-xs;
    }
    :host(.is-icon) {
      @apply p-2 aspect-square;
    }
    /* Keyboard focus ring. The component's own :host box-shadow overrides the
       global :focus-visible rule (base.css), so restate the focus token here —
       last, so it wins over every variant's box-shadow while focused.
       --shadow-focus has no utility, so box-shadow stays raw. */
    :host(:focus-visible) {
      @apply outline-none;
      box-shadow: var(--shadow-focus);
    }
  `,
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('default');
  readonly size = input<ButtonSize>('md');
  /** Square, padding-only button sized for a single glyph. */
  readonly icon = input(false, { transform: booleanAttribute });
  /** Destructive tone; composes with any variant. */
  readonly danger = input(false, { transform: booleanAttribute });
  /**
   * Selected/pressed highlight for a toggle or segmented choice. Paint only — the
   * consumer owns the matching `aria-pressed`/`aria-current`.
   */
  readonly active = input(false, { transform: booleanAttribute });
}
