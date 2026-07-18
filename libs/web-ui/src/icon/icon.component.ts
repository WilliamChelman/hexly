import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { IconHostDirective } from './icon-host.directive';
import { IconName, IconRegistry } from './icon-registry';

/**
 * One glyph, picked by `name` from the {@link IconRegistry} and drawn in `currentColor` at `size`
 * (ADR-0007). The vocabulary is web-ui's built-in glyphs plus any a plugin registers with
 * `provideIcons` — the markup is trusted and injected verbatim (`bypassSecurityTrustHtml` skips the
 * sanitizer that would strip the `<svg>`). An unregistered name (e.g. a disabled plugin's glyph)
 * draws an empty box rather than throwing. For a runtime/arbitrary path, use {@link IconPath}.
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [IconHostDirective],
  host: { '[innerHTML]': 'svg()' },
  template: '',
})
export class IconComponent {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly registry = inject(IconRegistry);

  readonly name = input.required<IconName>();
  readonly size = input(24);

  protected readonly svg = computed(() => {
    const { attrs, body } = this.registry.get(this.name()) ?? { attrs: '', body: '' };
    const s = this.size();
    return this.sanitizer.bypassSecurityTrustHtml(
      `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" ${attrs}>${body}</svg>`,
    );
  });
}
