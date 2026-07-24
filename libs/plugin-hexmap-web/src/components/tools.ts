import { IconName } from '@hexly/web-ui';
import { featureLibrary } from '@hexly/plugin-hexmap';
import { ToolId } from '../services/hexmap-store';

/**
 * A Tool's palette glyph: one of web-ui's built-in icons, or SVG path art this lib owns
 * ({@link featureLibrary}) — web-ui's icon vocabulary carries no plugin's (ADR-0050).
 */
export type ToolGlyph = { readonly icon: IconName } | { readonly path: string };

/** One top-level Tool's identity: its stable id, keyboard hotkey, and palette glyph. */
export interface ToolDef {
  readonly id: ToolId;
  /**
   * The single lowercase letter that arms this Tool from the keyboard — the
   * canonical form, matched against `KeyboardEvent.key` (which the keyboard path
   * lowercases). The palette upper-cases it for the keycap.
   */
  readonly hotkey: string;
  readonly glyph: ToolGlyph;
}

/** The marker art of a built-in Feature, by id — the source of truth is the library, not a copy. */
const featurePath = (id: string): string => featureLibrary.find((f) => f.id === id)?.path ?? '';

/**
 * The top-level Tools, in palette order. `region` is absent: it has no palette button or hotkey and
 * is armed via the Inspector's Add/Remove brush (ADR-0012). The visible name is resolved at the UI
 * layer from the stable `id` (`map.toolPalette.<id>`, ADR-0014).
 */
export const TOOLS: readonly ToolDef[] = [
  { id: 'select', hotkey: 's', glyph: { icon: 'select' } },
  { id: 'terrain', hotkey: 't', glyph: { icon: 'terrain' } },
  { id: 'feature', hotkey: 'f', glyph: { path: featurePath('settlement') } },
  { id: 'label', hotkey: 'l', glyph: { icon: 'label' } },
  { id: 'erase', hotkey: 'e', glyph: { icon: 'erase' } },
];

/** The Tool a keyboard key arms, or undefined for a non-hotkey key. Case-insensitive. */
export function toolForHotkey(key: string): ToolId | undefined {
  const lower = key.toLowerCase();
  return TOOLS.find((t) => t.hotkey === lower)?.id;
}
