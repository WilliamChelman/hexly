import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Colour family of a chip — undefined is the neutral chip.
 *
 * `tone-1…8` are the **categorical** set (ADR-0075): eight hue rotations off the accent whose only
 * job is mutual distinguishability. `accent` is the through-line accent, not a category.
 */
export type ChipTone = 'accent' | 'tone-1' | 'tone-2' | 'tone-3' | 'tone-4' | 'tone-5' | 'tone-6' | 'tone-7' | 'tone-8';

/**
 * A chip / badge. Projects its content, which may include an icon or a nested swatch.
 * `tone` selects a colour family; omit it for the neutral chip. See ADR-0007.
 *
 *   <app-chip>Default</app-chip>
 *   <app-chip tone="tone-3"><app-icon name="region" [size]="12" />Settlement</app-chip>
 *
 * A tone's category rides its **text and border** colour: the eight `-soft` fills land within
 * ΔE00 1.4 of each other at α 0.14, so the fill is a neutral tint and not a signal (ADR-0075).
 * Colour is decoration here in any case — the arc the tones sit on is the deuteranope confusion
 * line — so a chip standing for an Entity Type projects that type's icon alongside its label.
 */
@Component({
  selector: 'app-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tone]': 'tone() ?? null' },
  template: `<ng-content />`,
  styles: `
    @reference '#app-styles.css';

    /* Display-face small-caps badge, widely tracked. Base fully converts —
       off-scale padding (3/11px) rides arbitrary utilities. */
    :host {
      @apply inline-flex items-center gap-2 py-[3px] px-[11px] font-display
        text-2xs tracking-[0.22em] uppercase text-ink-muted bg-surface-sunken
        border border-line-strong rounded-full;
    }
    /* Tone variants: token color/bg convert; only color-mix stays raw (ADR-0021).
       The border sits at 36%, where the eight categoricals separate 2.5× better
       than their fills do — it and the text are what carry the category. */
    :host([data-tone='accent']) {
      @apply text-accent border-line-strong;
      background: color-mix(in oklab, var(--color-accent) 12%, transparent);
    }
    :host([data-tone='tone-1']) {
      @apply text-tone-1 bg-tone-1-soft;
      border-color: color-mix(in oklab, var(--color-tone-1) 36%, transparent);
    }
    :host([data-tone='tone-2']) {
      @apply text-tone-2 bg-tone-2-soft;
      border-color: color-mix(in oklab, var(--color-tone-2) 36%, transparent);
    }
    :host([data-tone='tone-3']) {
      @apply text-tone-3 bg-tone-3-soft;
      border-color: color-mix(in oklab, var(--color-tone-3) 36%, transparent);
    }
    :host([data-tone='tone-4']) {
      @apply text-tone-4 bg-tone-4-soft;
      border-color: color-mix(in oklab, var(--color-tone-4) 36%, transparent);
    }
    :host([data-tone='tone-5']) {
      @apply text-tone-5 bg-tone-5-soft;
      border-color: color-mix(in oklab, var(--color-tone-5) 36%, transparent);
    }
    :host([data-tone='tone-6']) {
      @apply text-tone-6 bg-tone-6-soft;
      border-color: color-mix(in oklab, var(--color-tone-6) 36%, transparent);
    }
    :host([data-tone='tone-7']) {
      @apply text-tone-7 bg-tone-7-soft;
      border-color: color-mix(in oklab, var(--color-tone-7) 36%, transparent);
    }
    :host([data-tone='tone-8']) {
      @apply text-tone-8 bg-tone-8-soft;
      border-color: color-mix(in oklab, var(--color-tone-8) 36%, transparent);
    }
  `,
})
export class ChipComponent {
  readonly tone = input<ChipTone>();
}
