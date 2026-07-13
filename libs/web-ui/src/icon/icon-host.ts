import { Directive } from '@angular/core';

/**
 * The shared host styling every SVG glyph wears (ADR-0007), applied through
 * `hostDirectives`: inline flex with zero line-height, so the `<svg>` sits
 * flush with no descender gap under it.
 */
@Directive({
  selector: '[appIconHost]',
  host: { class: 'inline-flex leading-[0]' },
})
export class IconHost {}
