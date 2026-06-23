import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
} from '@angular/core';

/**
 * A square, icon-only button — the shared primitive behind the floating tool
 * strip, its Subtool flyout, and the right-edge rail (ADR-0013, ADR-0007). It is
 * pure chrome: the caller projects exactly one leading mark as content — a colour
 * `swatch` (terrain Subtools), a library `app-icon-path` (feature Subtools), or a
 * named glyph component (Tools and undo/redo) — so adding a new mark never edits
 * this primitive. It carries no inline label — the caller supplies a `title`
 * tooltip (`Terrain (T)`) and an `aria-label` for discoverability, reusing the
 * edge rail's existing pattern. Uses an attribute selector on the native
 * `<button>`, so `disabled`, `type`, and focus/a11y come for free.
 *
 * A button that represents an on/off or selected state opts into toggle
 * semantics with `toggle`, which emits `aria-pressed` from `active`. Momentary
 * action buttons (undo/redo) leave it off so they aren't announced as toggles.
 *
 *   <button appIconButton toggle [active]="armed()"
 *           title="Terrain (T)" aria-label="Terrain" (click)="arm()">
 *     <app-icon-terrain [size]="20" />
 *   </button>
 */
@Component({
  selector: 'button[appIconButton]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-active]': 'active()',
    '[attr.aria-pressed]': 'toggle() ? active() : null',
    '[attr.type]': '"button"',
  },
  template: `<ng-content />`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--spacing-7);
      height: var(--spacing-7);
      color: var(--color-ink-muted);
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      cursor: pointer;
      transition:
        background-color var(--dur-fast) var(--ease-out),
        border-color var(--dur-fast) var(--ease-out),
        color var(--dur-fast) var(--ease-out);
    }
    :host(:hover:not(:disabled)) {
      color: var(--color-ink);
      background: var(--color-gold-soft);
    }
    :host(.is-active) {
      color: var(--color-gold);
      background: var(--color-gold-soft);
      border-color: var(--color-gold);
    }
    :host(:disabled) {
      opacity: 0.4;
      cursor: not-allowed;
    }
  `,
})
export class IconButton {
  /** The selected/armed highlight; also feeds `aria-pressed` when `toggle` is set. */
  readonly active = input(false, { transform: booleanAttribute });
  /**
   * Marks this button as a toggle so it exposes `aria-pressed` (from `active`).
   * Off by default: a momentary action (undo/redo) must not read as a toggle.
   */
  readonly toggle = input(false, { transform: booleanAttribute });
}
