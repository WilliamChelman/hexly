import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import type { Editor } from '@tiptap/core';

/**
 * Mounts a TipTap {@link Editor}'s editable surface into the host element.
 *
 * TipTap renders into a detached `<div>` by default; this relocates that surface into
 * our host. Done in an `effect` (not `ngOnInit`), so it re-runs when the `editor`
 * instance is swapped — the seed reload in {@link NoteView} recreates the editor, and
 * `replaceChildren` drops the old surface and mounts the new one in one step. ngx-tiptap
 * mounted only once in `ngOnInit` and couldn't react to that swap; this replaces it.
 */
@Directive({ selector: '[appTiptap]' })
export class TiptapDirective {
  readonly editor = input.required<Editor>({ alias: 'appTiptap' });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    effect(() => this.host.nativeElement.replaceChildren(this.editor().view.dom));
  }
}
