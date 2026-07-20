import { IconName } from '@hexly/web-ui';
import { ToolId } from '../services/board-store';

/** One top-level Tool's identity: its stable id, keyboard hotkey, and palette glyph. */
export interface ToolDef {
  readonly id: ToolId;
  /**
   * The single lowercase letter that arms this Tool from the keyboard — the canonical form, matched
   * against `KeyboardEvent.key` (which the keyboard path lowercases). The palette upper-cases it for
   * the keycap.
   */
  readonly hotkey: string;
  /** The palette glyph, by name: a core web-ui icon or one the plugin registers (`provideIcons`, ADR-0050). */
  readonly glyph: IconName;
}

/**
 * The top-level Tools, in palette order: the non-destructive Select first (the boot default), the
 * minimal Box placement Tool (Seam B, #267), the Text Block Tool (#268), the Image Tool (#269), then the
 * Embed Tool (#270). Every glyph is a Lucide icon — the `board-*` ones registered in `providePluginBoard`,
 * `text` reusing core `label`. The visible name is resolved at the UI layer from the stable `id`
 * (`board.toolPalette.<id>`, ADR-0014).
 */
export const TOOLS: readonly ToolDef[] = [
  { id: 'select', hotkey: 'v', glyph: 'select' },
  { id: 'box', hotkey: 'b', glyph: 'board-box' },
  { id: 'text', hotkey: 't', glyph: 'label' },
  { id: 'image', hotkey: 'i', glyph: 'board-image' },
  { id: 'embed', hotkey: 'e', glyph: 'board-embed' },
];

/** The Tool a keyboard key arms, or undefined for a non-hotkey key. Case-insensitive. */
export function toolForHotkey(key: string): ToolId | undefined {
  const lower = key.toLowerCase();
  return TOOLS.find((t) => t.hotkey === lower)?.id;
}
