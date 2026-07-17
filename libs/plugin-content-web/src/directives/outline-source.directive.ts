import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';
import { OutlineStore } from '../services/outline-store';

/**
 * Registers a Content editor element with the {@link OutlineStore}, so the panel scopes its heading
 * and scroll-port queries to this exact editor rather than a document-wide `.ProseMirror` lookup
 * that a second editor on the page would break.
 *
 * The store is optional: a Content editor may be mounted outside an Outline-scoped route.
 */
@Directive({ selector: '[appOutlineSource]' })
export class OutlineSourceDirective {
  private readonly store = inject(OutlineStore, { optional: true });
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    const store = this.store;
    if (!store) return;
    store.setContentRoot(this.element.nativeElement);
    inject(DestroyRef).onDestroy(() => store.setContentRoot(null));
  }
}
