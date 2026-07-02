import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  createComponent,
  input,
  output,
} from '@angular/core';
import { Editor } from '@tiptap/core';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeView } from '@tiptap/pm/view';

/**
 * The `callout` node view (ADR-0033): renders an Obsidian admonition as a coloured
 * box with a non-editable header above an **editable body**. The header carries a
 * freetext `<input>` for the callout `type` (any value, matching Obsidian's open set)
 * and the optional `title`. The body element is handed to ProseMirror as `contentDOM`,
 * so the block children render into it natively — inner `entityLink`s and other nodes
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
        <!-- change (not input): one transaction on blur/enter, not per keystroke. -->
        <input
          class="callout-type"
          aria-label="Callout type"
          [value]="type()"
          (change)="typeChange.emit($any($event.target).value)"
        />
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
  /** The reader edited the type; the bridge writes it back to the node attr. */
  readonly typeChange = output<string>();
}

/**
 * Bridge a ProseMirror `callout` node to a {@link CalloutView}. Mirrors the
 * entityLink bridge, but returns a `contentDOM` (the `[data-callout-body]` element)
 * because a callout has editable children — so no `stopEvent`/`ignoreMutation`
 * blanket blocks; `ignoreMutation` only shields Angular's own chrome re-renders
 * (the header) from ProseMirror's mutation observer, leaving the body to PM.
 *
 * `editor` + `getPos` let the type `<select>` write back: on change it dispatches a
 * `setNodeMarkup` at the node's position, and PM's resulting `update()` re-renders
 * the header. No `elementInjector` needed (unlike entityLink): the chrome carries no
 * `routerLink`, so it doesn't reach for `ActivatedRoute`.
 */
export function createCalloutNodeView(
  node: ProseMirrorNode,
  editor: Editor,
  getPos: () => number | undefined,
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

  // Write a picked type back into the document at the node's live position.
  const sub = ref.instance.typeChange.subscribe((type: string) => {
    const pos = getPos();
    if (pos == null) return;
    const current = editor.state.doc.nodeAt(pos);
    if (!current) return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, type }),
    );
  });

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
      sub.unsubscribe();
      appRef.detachView(ref.hostView);
      ref.destroy();
    },
  };
}
