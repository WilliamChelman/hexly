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
 *     <app-icon name="terrain" [size]="20" />
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
    @reference '../../styles.css';

    :host {
      /* 42px codex tool gem (20px glyph + padding) → arbitrary w/h (off-scale). */
      @apply inline-flex items-center justify-center w-[2.625rem] h-[2.625rem]
        text-ink-muted border border-transparent rounded-lg cursor-pointer;
      /* faint sunken fill (color-mix) + custom transition (motion tokens) stay raw. */
      background: color-mix(in srgb, var(--color-bg-deep) 50%, transparent);
      transition:
        background-color var(--dur-fast) var(--ease-out),
        border-color var(--dur-fast) var(--ease-out),
        color var(--dur-fast) var(--ease-out);
    }
    /* Hover (only when not armed): gold glyph + gilded border, fill unchanged. */
    :host(:hover:not(:disabled):not(.is-active)) {
      @apply text-gold border-line-strong;
    }
    /* Armed/selected — a gilded gem: radial gold gradient + glow halo (raw). */
    :host(.is-active) {
      @apply text-on-gilded;
      background: var(--gradient-gold-radial);
      border-color: color-mix(in srgb, var(--color-gold-bright) 60%, #fff);
      box-shadow:
        0 0 0 1px var(--color-glow),
        0 0 16px -1px var(--color-glow);
    }
    :host(:disabled) {
      @apply opacity-40 cursor-not-allowed;
    }
    /* Keyboard focus ring — restated here because the host's own box-shadow
       overrides the global :focus-visible rule (base.css). Last, so it wins. */
    :host(:focus-visible) {
      @apply outline-none;
      box-shadow: var(--shadow-focus);
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
