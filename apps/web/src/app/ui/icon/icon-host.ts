import { Directive } from '@angular/core';

/**
 * The shared host styling every SVG glyph wears (ADR-0007): lay the host out as
 * an inline flex box with zero line-height so the `<svg>` sits flush, with no
 * descender gap under it. Every glyph applies it through `hostDirectives`, so
 * this one rule lives here instead of being repeated on each component's `host`.
 */
@Directive({
  selector: '[appIconHost]',
  host: { class: 'inline-flex leading-[0]' },
})
export class IconHost {}
