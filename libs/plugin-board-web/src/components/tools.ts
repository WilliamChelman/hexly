import { IconName } from '@hexly/web-ui';
import { ToolId } from '../services/board-store';

/**
 * A Tool's palette glyph: one of web-ui's built-in icons, or SVG path art this lib owns — web-ui's icon
 * vocabulary carries no plugin's (ADR-0050). The minimal Box uses a path so the lib stays self-contained.
 */
export type ToolGlyph = { readonly icon: IconName } | { readonly path: string };

/** One top-level Tool's identity: its stable id, keyboard hotkey, and palette glyph. */
export interface ToolDef {
  readonly id: ToolId;
  /**
   * The single lowercase letter that arms this Tool from the keyboard — the canonical form, matched
   * against `KeyboardEvent.key` (which the keyboard path lowercases). The palette upper-cases it for
   * the keycap.
   */
  readonly hotkey: string;
  readonly glyph: ToolGlyph;
}

/** A plain rectangle glyph for the Box tool — a 24-box outline, matching web-ui's icon viewBox. */
const BOX_PATH = 'M4 5h16v14H4z';

/**
 * The top-level Tools, in palette order: the non-destructive Select first (the boot default), then the
 * minimal Box placement Tool (Seam B, #267). The Text Block (#268) and Image (#269) Tools slot in after.
 * The visible name is resolved at the UI layer from the stable `id` (`board.toolPalette.<id>`, ADR-0014).
 */
export const TOOLS: readonly ToolDef[] = [
  { id: 'select', hotkey: 'v', glyph: { icon: 'select' } },
  { id: 'box', hotkey: 'b', glyph: { path: BOX_PATH } },
];

/** The Tool a keyboard key arms, or undefined for a non-hotkey key. Case-insensitive. */
export function toolForHotkey(key: string): ToolId | undefined {
  const lower = key.toLowerCase();
  return TOOLS.find((t) => t.hotkey === lower)?.id;
}
