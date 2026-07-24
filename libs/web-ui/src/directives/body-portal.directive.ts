import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/**
 * Teleport the host element to `<body>` once it first renders, so it escapes any ancestor that has
 * become the containing block for fixed positioning. A CSS `transform`/`scale` on an ancestor — even an
 * identity one — captures its `position: fixed` descendants, anchoring them to the transformed box
 * instead of the viewport. The Board zooms a Text Block by scaling it (ADR-0048), which strands the
 * editor's caret-anchored popups (the `@`/`/`/`::` pickers) far from the caret; at `<body>` their
 * viewport coordinates read true again. A harmless no-op wherever no such ancestor exists (a note).
 *
 * Safe under Angular teardown: the framework removes a node by calling `.remove()` on the node itself
 * (ignoring the recorded parent), so a node relocated to `<body>` is still torn down when its `@if`
 * collapses. Apply it to the element the `@if` creates/destroys directly, so that removal reaches here.
 */
@Directive({ selector: '[appBodyPortal]' })
export class BodyPortalDirective {
  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => document.body.appendChild(el.nativeElement));
  }
}
