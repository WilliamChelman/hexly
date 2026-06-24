import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { featureLibrary } from '@hexly/domain';
import { IconHost } from './icon-host';

/** The settlement marker art, shared with the canvas via `featureLibrary` (ADR-0006). */
const SETTLEMENT_PATH =
  featureLibrary.find((f) => f.id === 'settlement')?.path ?? '';

/**
 * Every built-in glyph as data (ADR-0007): the `<svg>` root attributes that vary
 * per glyph plus its inner markup. The shared bits — `viewBox`, `fill="none"`,
 * size — are applied by {@link Icon}. One entry replaces one former component.
 * For a runtime/arbitrary path (e.g. a Feature's `path`), use {@link IconPath}.
 */
const GLYPHS = {
  erase: {
    attrs:
      'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"',
    body: '<path d="M8 17l-3-3a1.8 1.8 0 0 1 0-2.6l6-6a1.8 1.8 0 0 1 2.6 0l3.4 3.4a1.8 1.8 0 0 1 0 2.6L13 17z" /><path d="M6 20h13" />',
  },
  fit: {
    attrs:
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"',
    body: '<path d="M5 9V5h4M19 9V5h-4M5 15v4h4M19 15v4h-4" />',
  },
  label: {
    attrs: 'stroke="currentColor" stroke-width="1.5" stroke-linecap="round"',
    body: '<path d="M6 6h12M12 6v12M9.5 18h5" />',
  },
  logo: {
    attrs: '',
    body: '<path d="M12 2.2 20.5 7v10L12 21.8 3.5 17V7z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /><path d="M12 7.4 16.2 9.9v4.2L12 16.6 7.8 14.1V9.9z" fill="currentColor" opacity=".5" />',
  },
  marquee: {
    attrs:
      'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-dasharray="3 2.5"',
    body: '<rect x="4" y="4" width="16" height="16" rx="1" />',
  },
  minus: {
    attrs: 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round"',
    body: '<path d="M6 12h12" />',
  },
  moon: {
    attrs: '',
    body: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /><circle cx="15.5" cy="7.5" r=".9" fill="currentColor" /><circle cx="18" cy="11" r=".6" fill="currentColor" />',
  },
  plus: {
    attrs: 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round"',
    body: '<path d="M12 6v12M6 12h12" />',
  },
  redo: {
    attrs:
      'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"',
    body: '<path d="M15 7H9a5 5 0 0 0 0 10h7" /><path d="M15 3l4 4-4 4" />',
  },
  region: {
    attrs:
      'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-dasharray="3 2.5"',
    body: '<path d="M5 7c4-3 9-2 12 1s2 8-2 10-11 1-12-4 2-4 2-7z" />',
  },
  select: {
    attrs:
      'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"',
    body: '<path d="M5 4l5 15 2.5-6 6-2.5z" />',
  },
  settlement: {
    attrs:
      'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"',
    body: `<path d="${SETTLEMENT_PATH}" />`,
  },
  share: {
    attrs:
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"',
    body: '<circle cx="6" cy="12" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="18" cy="18" r="2.4" /><path d="m8.1 10.8 7.8-3.6M8.1 13.2l7.8 3.6" />',
  },
  sun: {
    attrs: 'stroke="currentColor" stroke-width="1.6" stroke-linecap="round"',
    body: '<circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.5 12h-2M21.5 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4" />',
  },
  terrain: {
    attrs: 'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"',
    body: '<path d="M12 3l7 4.5v9L12 21l-7-4.5v-9z" />',
  },
  undo: {
    attrs:
      'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"',
    body: '<path d="M9 7H15a5 5 0 0 1 0 10H8" /><path d="M9 3 5 7l4 4" />',
  },
  user: {
    attrs:
      'stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"',
    body: '<circle cx="12" cy="8" r="3.5" /><path d="M5.5 19a6.5 6.5 0 0 1 13 0" />',
  },
} as const;

export type IconName = keyof typeof GLYPHS;

/**
 * One built-in glyph, picked by `name` and drawn in `currentColor` at `size`
 * (ADR-0007). Replaces the per-glyph components: `<app-icon name="sun" />`,
 * usable statically or with a bound `[name]` for data-driven strips (the tool
 * palette, the rail). The glyph table is static, trusted markup we author, so it
 * is injected verbatim — `bypassSecurityTrustHtml` skips the sanitizer that
 * would otherwise strip the `<svg>`.
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [IconHost],
  host: { '[innerHTML]': 'svg()' },
  template: '',
})
export class Icon {
  private readonly sanitizer = inject(DomSanitizer);

  readonly name = input.required<IconName>();
  readonly size = input(24);

  protected readonly svg = computed(() => {
    const { attrs, body } = GLYPHS[this.name()];
    const s = this.size();
    return this.sanitizer.bypassSecurityTrustHtml(
      `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" ${attrs}>${body}</svg>`,
    );
  });
}
