import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  createComponent,
  input,
} from '@angular/core';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeView } from '@tiptap/pm/view';

/**
 * The `callout` node view (ADR-0033): renders an Obsidian admonition as a coloured
 * box with a non-editable header (its `type` badge + optional `title`) above an
 * **editable body**. The body element is handed to ProseMirror as `contentDOM`, so
 * the block children render into it natively — inner `entityLink`s and other nodes
 * stay live and clickable, the point of modelling callout as block content.
 */
@Component({
  selector: 'app-callout-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="callout" [attr.data-callout]="type()">
      <!-- contenteditable=false: the chrome is ours; ProseMirror only owns the body. -->
      <div class="callout-header" contenteditable="false">
        <span class="callout-type">{{ type() }}</span>
        @if (title()) {
          <span class="callout-title">{{ title() }}</span>
        }
      </div>
      <!-- Empty in the template: ProseMirror fills it as contentDOM (see bridge). -->
      <div class="callout-body" data-callout-body></div>
    </div>
  `,
})
export class CalloutView {
  readonly type = input.required<string>();
  readonly title = input<string | null>(null);
}

/**
 * Bridge a ProseMirror `callout` node to a {@link CalloutView}. Mirrors the
 * entityLink bridge, but returns a `contentDOM` (the `[data-callout-body]` element)
 * because a callout has editable children — so no `stopEvent`/`ignoreMutation`
 * blanket blocks; `ignoreMutation` only shields Angular's own chrome re-renders
 * (the header) from ProseMirror's mutation observer, leaving the body to PM.
 *
 * No `elementInjector` needed (unlike entityLink): the callout chrome carries no
 * `routerLink`, so it doesn't reach for `ActivatedRoute`.
 */
export function createCalloutNodeView(
  node: ProseMirrorNode,
  environmentInjector: EnvironmentInjector,
  appRef: ApplicationRef,
): NodeView {
  const ref = createComponent(CalloutView, { environmentInjector });
  const apply = (n: ProseMirrorNode) => {
    ref.setInput('type', n.attrs['type'] ?? 'note');
    ref.setInput('title', n.attrs['title'] ?? null);
    // Render the chrome synchronously: PM needs [data-callout-body] present the
    // moment it mounts this dom, and later attr updates must reflect at once.
    ref.changeDetectorRef.detectChanges();
  };
  apply(node);
  appRef.attachView(ref.hostView);

  const dom = ref.location.nativeElement as HTMLElement;
  const contentDOM = dom.querySelector('[data-callout-body]') as HTMLElement;

  return {
    dom,
    contentDOM,
    update: (updated) => {
      if (updated.type.name !== node.type.name) return false;
      apply(updated);
      return true;
    },
    // PM handles mutations inside the editable body; ignore Angular re-rendering the header.
    ignoreMutation: (mutation) =>
      mutation.type !== 'selection' && !contentDOM.contains(mutation.target as globalThis.Node),
    destroy: () => {
      appRef.detachView(ref.hostView);
      ref.destroy();
    },
  };
}
