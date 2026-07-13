/**
 * The single content-aware seam (ADR-0019): every derivation from a Content snapshot
 * (TipTap/ProseMirror JSON) routes through `ContentNode` + `visit`.
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
 * Pre-order walk of a Content snapshot: calls `fn` on every node, then descends its `content`.
 * Readers close over an accumulator; rewriters mutate the node they are handed in place —
 * structural transforms are not supported.
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
