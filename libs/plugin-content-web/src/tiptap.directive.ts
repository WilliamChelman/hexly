import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import type { Editor } from '@tiptap/core';

/**
 * Mounts a TipTap {@link Editor}'s editable surface (a detached `<div>`) into the host element.
 *
 * Mounted in an `effect`, not `ngOnInit`: the `editor` instance can be swapped (the seed reload
 * in {@link ContentEditor} recreates it), and the mount must follow the swap.
 */
@Directive({ selector: '[appTiptap]' })
export class TiptapDirective {
  readonly editor = input.required<Editor>({ alias: 'appTiptap' });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    effect(() => this.host.nativeElement.replaceChildren(this.editor().view.dom));
  }
}
