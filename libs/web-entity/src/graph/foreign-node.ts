import { WorldGraphNode } from '@hexly/domain';

/**
 * The glyph a **Foreign node**'s label wears (ADR-0080). A glyph rather than a word: the label layer is
 * 9px text over a WebGL field, and an arrow leaving the name needs no translating.
 */
export const FOREIGN_MARK = '↗';

/** What the renderer writes over a node — marked when the Entity lives in another **Container** (ADR-0080). */
export function nodeLabel(node: WorldGraphNode): string {
  return node.foreignContainerId ? `${FOREIGN_MARK} ${node.name}` : node.name;
}

/**
 * The share of its alpha a **Foreign node** keeps — an opacity multiplier, like `HOVER_DIM` beside it.
 * A second channel because the first rides an *elected* label, and a crowded view labels few of its nodes:
 * without this the mark would come and go with the zoom. The Entity Type's hue is untouched.
 */
export const FOREIGN_ALPHA_SCALE = 0.45;
