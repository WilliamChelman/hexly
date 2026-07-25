import type { MenuItemConstructorOptions } from 'electron';

/** As much of Electron's `context-menu` params as this menu reads. */
export interface ContextMenuTarget {
  /** The word under the cursor the spellchecker rejected, or `''`. */
  readonly misspelledWord: string;
  readonly dictionarySuggestions: readonly string[];
  readonly editFlags: {
    readonly canCut: boolean;
    readonly canCopy: boolean;
    readonly canPaste: boolean;
  };
}

/** What choosing an item asks of the page the menu was opened on. */
export interface ContextMenuActions {
  /** Replace the misspelled word under the cursor with `word`. */
  replaceMisspelling(word: string): void;
  /** Teach the spellchecker `word`, for this Instance and every one after it. */
  addToDictionary(word: string): void;
}

/** Chromium offers three today, and nothing promises that: a cap keeps a long list from burying what is below. */
const MAX_SUGGESTIONS = 5;

/**
 * The right-click menu for text. Electron ships **no** default context menu, so without this a right-click in
 * Content does nothing at all — and spelling suggestions, the half of spellchecking that fixes a word rather
 * than merely underlining it, would have nowhere to appear (ADR-0070).
 *
 * English only, for the same reason the application menu is: main has no transloco catalog.
 *
 * Empty when there is nothing to offer, so a right-click on a Hex Map or a Board's empty canvas stays a
 * gesture those surfaces own rather than putting up a menu of greyed-out items.
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
    // A misspelling with no suggestion is still worth saying out loud: the alternative reads as a broken menu.
    ...(suggestions.length
      ? suggestions.map((suggestion) => ({ label: suggestion, click: () => actions.replaceMisspelling(suggestion) }))
      : [{ label: 'No spelling suggestions', enabled: false }]),
    { type: 'separator' },
    // The escape hatch a worldbuilder needs most: invented names are the vocabulary, not mistakes.
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
