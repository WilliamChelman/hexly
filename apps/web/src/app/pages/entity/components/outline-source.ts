import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';
import { OutlineStore } from '../services/outline-store';

/**
 * Bridges a Content editor element to the {@link OutlineStore}: registers the
 * element whose headings the Outline lists, so the panel scopes its heading and
 * scroll-port queries to this exact editor rather than a fragile document-wide
 * `.ProseMirror` lookup that a second editor on the page would break.
 *
 * The store is optional — a Content editor may be mounted outside an
 * Outline-scoped route, where there is simply nothing to bridge to.
 */
@Directive({ selector: '[appOutlineSource]' })
export class OutlineSource {
  private readonly store = inject(OutlineStore, { optional: true });
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    const store = this.store;
    if (!store) return;
    store.setContentRoot(this.element.nativeElement);
    inject(DestroyRef).onDestroy(() => store.setContentRoot(null));
  }
}
