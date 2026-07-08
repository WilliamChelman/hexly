/**
 * The single content-aware seam (ADR-0019). `ContentNode` is the canonical shape
 * of a node within a Content snapshot (TipTap/ProseMirror JSON); `visit` is the one
 * sanctioned walk over it. Every derivation *from* Content — FTS text, Outline,
 * descriptor harvest, vault import/export rewrites — routes through here, so the
 * snapshot shape is known in exactly one place and a format bump touches only this
 * seam and the registered extension set, never the Entity model or storage.
 */

/** A node within a Content snapshot: its type, optional attrs/children/marks, and (for a leaf) its text. */
export interface ContentNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ContentNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

/**
 * Pre-order walk of a Content snapshot: calls `fn` on every node, then descends its
 * `content`. Narrows the opaque `unknown` snapshot to `ContentNode` in this one place,
 * so callers never cast. Readers close over an accumulator; rewriters mutate the node
 * they are handed in place (no site needs structural transforms — add them if one ever does).
 */
export function visit(snapshot: unknown, fn: (node: ContentNode) => void): void {
  if (Array.isArray(snapshot)) {
    for (const child of snapshot) visit(child, fn);
    return;
  }
  if (snapshot && typeof snapshot === 'object') {
    const node = snapshot as ContentNode;
    fn(node);
    visit(node.content, fn);
  }
}
