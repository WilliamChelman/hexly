import type { MenuItemConstructorOptions } from 'electron';

/** As much of Electron's `context-menu` params as this menu reads. */
export interface ContextMenuTarget {
  /** `''` when nothing under the cursor is misspelled. */
  readonly misspelledWord: string;
  readonly dictionarySuggestions: readonly string[];
  readonly editFlags: {
    readonly canCut: boolean;
    readonly canCopy: boolean;
    readonly canPaste: boolean;
  };
}

export interface ContextMenuActions {
  replaceMisspelling(word: string): void;
  /** Persists for this Instance and every one after it. */
  addToDictionary(word: string): void;
}

/** Chromium offers three today and nothing promises that; the cap keeps a long list from burying what is below. */
const MAX_SUGGESTIONS = 5;

/**
 * Electron ships **no** default context menu, so without this a right-click in Content does nothing and
 * spelling suggestions have nowhere to appear (ADR-0070). Empty when there is nothing to offer, so a
 * right-click on a Hex Map stays a gesture that surface owns; English only, like the application menu.
 */
export function buildContextMenuTemplate(
  target: ContextMenuTarget,
  actions: ContextMenuActions,
): MenuItemConstructorOptions[] {
  const blocks = [spellingBlock(target, actions), clipboardBlock(target)].filter((block) => block.length);
  // Separators between blocks rather than after each, so no menu can end on one.
  return blocks.flatMap((block, index) =>
    index ? [{ type: 'separator' } as MenuItemConstructorOptions, ...block] : block,
  );
}

function spellingBlock(target: ContextMenuTarget, actions: ContextMenuActions): MenuItemConstructorOptions[] {
  const word = target.misspelledWord;
  if (!word) return [];
  const suggestions = target.dictionarySuggestions.slice(0, MAX_SUGGESTIONS);
  return [
    // A misspelling with no suggestion still says so: the alternative reads as a broken menu.
    ...(suggestions.length
      ? suggestions.map((suggestion) => ({ label: suggestion, click: () => actions.replaceMisspelling(suggestion) }))
      : [{ label: 'No spelling suggestions', enabled: false }]),
    { type: 'separator' },
    // Invented names are a worldbuilder's vocabulary, not mistakes.
    { label: 'Add to Dictionary', click: () => actions.addToDictionary(word) },
  ];
}

/** Roles, so the platform performs the edit — the same reason the application menu's Edit menu is all roles. */
function clipboardBlock(target: ContextMenuTarget): MenuItemConstructorOptions[] {
  const { canCut, canCopy, canPaste } = target.editFlags;
  return [
    ...(canCut ? [{ role: 'cut' } as MenuItemConstructorOptions] : []),
    ...(canCopy ? [{ role: 'copy' } as MenuItemConstructorOptions] : []),
    ...(canPaste ? [{ role: 'paste' } as MenuItemConstructorOptions] : []),
  ];
}
