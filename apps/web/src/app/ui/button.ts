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
  },
  template: `<ng-content />`,
  styles: `
    :host {
      --_fg: var(--ink);
      --_bg: var(--surface-raised);
      --_bd: var(--line-strong);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-4);
      font-family: var(--font-body);
      font-size: var(--text-sm);
      font-weight: var(--weight-semibold);
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
      border-color: var(--gold);
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

    :host(.is-primary) {
      --_fg: var(--on-gold);
      --_bg: var(--gold);
      --_bd: var(--gold-strong);
    }
    :host(.is-primary:hover) {
      --_bg: var(--gold-strong);
      border-color: var(--gold-strong);
    }
    :host(.is-ghost) {
      --_bg: transparent;
      --_bd: transparent;
      box-shadow: none;
    }
    :host(.is-ghost:hover) {
      --_bg: var(--gold-soft);
      border-color: transparent;
      box-shadow: none;
    }
    :host(.is-danger) {
      --_fg: var(--ember);
      --_bd: color-mix(in oklab, var(--ember) 40%, var(--line));
    }
    :host(.is-danger:hover) {
      --_fg: var(--on-gold);
      --_bg: var(--ember);
      border-color: var(--ember);
    }
    :host(.is-sm) {
      padding: var(--space-1) var(--space-3);
      font-size: var(--text-xs);
    }
    :host(.is-icon) {
      padding: var(--space-2);
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
}
