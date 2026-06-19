import { Directive, booleanAttribute, input } from '@angular/core';

/** Emphasis of a button — how loudly it asks to be pressed. */
export type ButtonVariant = 'default' | 'primary' | 'ghost';
export type ButtonSize = 'md' | 'sm';

/**
 * Turns a native `<button>`/`<a>` into a Hexly button by mapping typed inputs
 * onto the token-driven `.btn` classes. It is a directive, not a wrapper
 * component, so the real element keeps its type, focus, form participation and
 * a11y — and so the visual definition can stay in the global token layer (a
 * directive owns no styles). See ADR-0007.
 *
 *   <button appButton variant="primary" size="sm">Share</button>
 *   <a appButton variant="ghost" routerLink="/styleguide">Design system</a>
 */
@Directive({
  selector: 'button[appButton], a[appButton]',
  host: {
    class: 'btn',
    '[class.btn--primary]': "variant() === 'primary'",
    '[class.btn--ghost]': "variant() === 'ghost'",
    '[class.btn--sm]': "size() === 'sm'",
    '[class.btn--icon]': 'icon()',
    '[class.btn--danger]': 'danger()',
  },
})
export class ButtonDirective {
  readonly variant = input<ButtonVariant>('default');
  readonly size = input<ButtonSize>('md');
  /** Square, padding-only button sized for a single glyph. */
  readonly icon = input(false, { transform: booleanAttribute });
  /** Destructive tone; composes with any variant. */
  readonly danger = input(false, { transform: booleanAttribute });
}
