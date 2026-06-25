import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/**
 * Focus the host element once after it first renders. Native `autofocus` only fires
 * on page load, not when an element is revealed by a `@if` block.
 */
@Directive({ selector: '[appAutofocus]' })
export class Autofocus {
  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => el.nativeElement.focus());
  }
}
