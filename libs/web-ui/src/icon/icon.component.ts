import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { isFontGlyph } from './icon-glyph';
import { IconHostDirective } from './icon-host.directive';
import { IconName, IconRegistry } from './icon-registry';

/**
 * One glyph, picked by `name` from the {@link IconRegistry} and drawn in `currentColor` (ADR-0007).
 * The vocabulary is web-ui's built-in glyphs plus any a plugin registers with `provideIcons` — of
 * either kind: an **SVG** glyph, injected verbatim as trusted markup (`bypassSecurityTrustHtml` skips
 * the sanitizer that would strip the `<svg>`) and sized by `size`; or a **font** glyph, rendered as a
 * character that inherits the caller's `font-size` (so `size` is ignored — control it with CSS). An
 * unregistered name (e.g. a disabled plugin's glyph) draws nothing rather than throwing. Decorative by
 * default; pass `label` when the glyph must be announced. For a runtime/arbitrary path, use {@link IconPath}.
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [IconHostDirective],
  host: {
    '[attr.role]': "label() ? 'img' : null",
    '[attr.aria-label]': 'label()',
    '[attr.aria-hidden]': 'label() ? null : true',
  },
  // The font branch interpolates `char` (auto-escaped, so a glyph like `<` is safe); the SVG branch
  // injects trusted markup. `line-height: 1` overrides the host's `leading-[0]` for the text glyph.
  template: `@if (fontGlyph(); as f) {
      <span style="line-height: 1" [style.font-family]="f.fontFamily">{{ f.char }}</span>
    } @else {
      <span [innerHTML]="svg()"></span>
    }`,
})
export class IconComponent {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly registry = inject(IconRegistry);

  readonly name = input.required<IconName>();
  /** Pixel size of an SVG glyph; ignored by a font glyph, which sizes to the inherited `font-size`. */
  readonly size = input(24);
  /** Optional accessible name; when set the glyph is announced (`role="img"`) instead of hidden. */
  readonly label = input<string | null>(null);

  private readonly glyph = computed(() => this.registry.get(this.name()));

  protected readonly fontGlyph = computed(() => {
    const glyph = this.glyph();
    return glyph && isFontGlyph(glyph) ? glyph : null;
  });

  protected readonly svg = computed(() => {
    const glyph = this.glyph();
    const { attrs, body } = glyph && !isFontGlyph(glyph) ? glyph : { attrs: '', body: '' };
    const s = this.size();
    return this.sanitizer.bypassSecurityTrustHtml(
      `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" ${attrs}>${body}</svg>`,
    );
  });
}
