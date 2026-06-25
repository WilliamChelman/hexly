import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/**
 * Focus the host element once, right after it first renders. The browser's native
 * `autofocus` attribute only fires on the initial page load, not when an element
 * is later revealed by a `@if` (e.g. the browser's inline rename input), so this
 * puts the caret in the field as soon as it appears — letting the user type or
 * press Enter/Escape immediately instead of having to click it first.
 */
@Directive({ selector: '[appAutofocus]' })
export class Autofocus {
  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => el.nativeElement.focus());
  }
}
