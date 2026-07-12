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
 *
 * Keyboard model (arrow-driven, not Tab — the input is `tabindex=-1` so it never
 * hijacks the document's Tab order): `ArrowUp` from the top line of the body focuses
 * the type input (see {@link focusCalloutTypeAtTop}); from the input, `ArrowDown`/
 * `Enter`/`Escape` drop back into the body and `ArrowUp` leaves to the block above.
 */
@Component({
  selector: 'app-callout-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="callout" [attr.data-callout]="type()">
      <!-- contenteditable=false: the chrome is ours; ProseMirror only owns the body. -->
      <div class="callout-header" contenteditable="false">
        <!--
          tabindex=-1 keeps it out of the Tab order (Tab from anywhere would otherwise
          jump here); arrow keys are the way in/out. change (not input) commits one
          transaction on blur/enter, not per keystroke.
        -->
        <input
          class="callout-type"
          aria-label="Callout type"
          tabindex="-1"
          [value]="type()"
          (change)="typeChange.emit($any($event.target).value)"
          (keydown.arrowup)="exitAbove.emit(); $event.preventDefault()"
          (keydown.arrowdown)="exitToBody.emit(); $event.preventDefault()"
          (keydown.enter)="exitToBody.emit(); $event.preventDefault()"
          (keydown.escape)="exitToBody.emit()"
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
  /** Leave the type input downward — caret into the callout body. */
  readonly exitToBody = output<void>();
  /** Leave the type input upward — caret to the block above the callout. */
  readonly exitAbove = output<void>();
}

/**
 * ProseMirror keymap (wired at the editor): `ArrowUp` when the caret is on the top
 * line of a callout's first block focuses that callout's type input — the arrow-key
 * way into the chrome. Returns false otherwise so normal cursor motion is untouched.
 * `view.endOfTextblock('up')` accounts for wrapped lines, so it only fires from the
 * genuine top line. In a bare editor with no node view (specs) there's no input, so
 * it's a safe no-op.
 */
export function focusCalloutTypeAtTop(editor: Editor): boolean {
  const { state, view } = editor;
  const { selection } = state;
  if (!selection.empty || !view.endOfTextblock('up')) return false;

  const $from = selection.$from;
  for (let depth = $from.depth; depth >= 1; depth--) {
    if ($from.node(depth).type.name !== 'callout') continue;
    const calloutPos = $from.before(depth);
    // Only from the callout's first child block (its content opens at calloutPos + 1).
    if ($from.before($from.depth) !== calloutPos + 1) return false;
    const dom = view.nodeDOM(calloutPos) as HTMLElement | null;
    const inputEl = dom?.querySelector?.('input.callout-type') as HTMLInputElement | null;
    if (!inputEl) return false;
    inputEl.focus();
    inputEl.select();
    return true;
  }
  return false;
}

/**
 * Bridge a ProseMirror `callout` node to a {@link CalloutView}. Mirrors the
 * entityLink bridge, but returns a `contentDOM` (the `[data-callout-body]` element)
 * because a callout has editable children — so no `stopEvent`/`ignoreMutation`
 * blanket blocks; `ignoreMutation` only shields Angular's own chrome re-renders
 * (the header) from ProseMirror's mutation observer, leaving the body to PM.
 *
 * `editor` + `getPos` let the type `<input>` write back and drive arrow-key exits: a
 * change dispatches `setNodeMarkup`; an exit moves the PM selection (into the body,
 * or to the block above) and refocuses the editor. No `elementInjector` needed
 * (unlike entityLink): the chrome carries no `routerLink`, so no `ActivatedRoute`.
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

  const subscriptions = [
    // Write a picked type back into the document at the node's live position.
    ref.instance.typeChange.subscribe((type: string) => {
      const pos = getPos();
      if (pos == null) return;
      const current = editor.state.doc.nodeAt(pos);
      if (!current) return;
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, {
          ...current.attrs,
          type,
        }),
      );
    }),
    // ArrowDown/Enter/Escape → caret at the start of the callout body (pos+2: into
    // the callout, then into its first child block).
    ref.instance.exitToBody.subscribe(() => {
      const pos = getPos();
      if (pos != null)
        editor
          .chain()
          .focus()
          .setTextSelection(pos + 2)
          .run();
    }),
    // ArrowUp → caret to the end of the block above the callout (pos-1), clamped.
    ref.instance.exitAbove.subscribe(() => {
      const pos = getPos();
      if (pos != null)
        editor
          .chain()
          .focus()
          .setTextSelection(Math.max(0, pos - 1))
          .run();
    }),
  ];

  const dom = ref.location.nativeElement as HTMLElement;
  const header = dom.querySelector('.callout-header') as HTMLElement;
  const contentDOM = dom.querySelector('[data-callout-body]') as HTMLElement;

  return {
    dom,
    contentDOM,
    update: (updated) => {
      if (updated.type.name !== node.type.name) return false;
      apply(updated);
      return true;
    },
    // Leave header-chrome events (the type <input>: keys, caret, clicks) to the
    // browser — otherwise PM's keymap catches e.g. Backspace and deletes the node.
    // Body events fall through to PM as normal editable content.
    stopEvent: (event) => header.contains(event.target as globalThis.Node),
    // PM handles mutations inside the editable body; ignore Angular re-rendering the header.
    ignoreMutation: (mutation) =>
      mutation.type !== 'selection' && !contentDOM.contains(mutation.target as globalThis.Node),
    destroy: () => {
      subscriptions.forEach((s) => s.unsubscribe());
      appRef.detachView(ref.hostView);
      ref.destroy();
    },
  };
}
