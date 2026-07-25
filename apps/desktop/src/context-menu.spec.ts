import type { MenuItemConstructorOptions } from 'electron';
import { buildContextMenuTemplate, type ContextMenuActions, type ContextMenuTarget } from './context-menu';

function target(overrides: Partial<ContextMenuTarget> = {}): ContextMenuTarget {
  return {
    misspelledWord: '',
    dictionarySuggestions: [],
    editFlags: { canCut: false, canCopy: false, canPaste: false },
    ...overrides,
  };
}

/** A caret in prose, with a misspelling under it. */
function inProse(overrides: Partial<ContextMenuTarget> = {}): ContextMenuTarget {
  return target({ editFlags: { canCut: false, canCopy: false, canPaste: true }, ...overrides });
}

function recorder(): ContextMenuActions & { readonly replaced: string[]; readonly learned: string[] } {
  const replaced: string[] = [];
  const learned: string[] = [];
  return {
    replaced,
    learned,
    replaceMisspelling: (word) => void replaced.push(word),
    addToDictionary: (word) => void learned.push(word),
  };
}

function labels(template: MenuItemConstructorOptions[]): (string | undefined)[] {
  return template.map((item) => (item.type === 'separator' ? '---' : (item.label ?? item.role)));
}

function choose(template: MenuItemConstructorOptions[], label: string): void {
  const item = template.find((candidate) => candidate.label === label);
  const click = item?.click as unknown as (() => void) | undefined;
  if (!click) throw new Error(`No item "${label}" in ${labels(template).join(', ')}`);
  click();
}

describe('buildContextMenuTemplate', () => {
  it('offers the spellchecker suggestions above the clipboard items', () => {
    const template = buildContextMenuTemplate(
      inProse({ misspelledWord: 'lighthose', dictionarySuggestions: ['lighthouse', 'lighthorse'] }),
      recorder(),
    );

    expect(labels(template)).toEqual(['lighthouse', 'lighthorse', '---', 'Add to Dictionary', '---', 'paste']);
  });

  it('replaces the word with the suggestion that was chosen', () => {
    const actions = recorder();
    const template = buildContextMenuTemplate(
      inProse({ misspelledWord: 'lighthose', dictionarySuggestions: ['lighthouse'] }),
      actions,
    );

    choose(template, 'lighthouse');

    expect(actions.replaced).toEqual(['lighthouse']);
  });

  it('teaches the spellchecker the word under the cursor', () => {
    const actions = recorder();
    const template = buildContextMenuTemplate(inProse({ misspelledWord: 'Vaelthorn' }), actions);

    choose(template, 'Add to Dictionary');

    expect(actions.learned).toEqual(['Vaelthorn']);
    expect(actions.replaced).toEqual([]);
  });

  it('says a misspelling has no suggestions rather than looking broken', () => {
    const template = buildContextMenuTemplate(inProse({ misspelledWord: 'Vaelthorn' }), recorder());

    expect(labels(template)).toEqual(['No spelling suggestions', '---', 'Add to Dictionary', '---', 'paste']);
    expect(template[0].enabled).toBe(false);
  });

  it('caps a long suggestion list so it cannot bury what is under it', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const template = buildContextMenuTemplate(
      inProse({ misspelledWord: 'x', dictionarySuggestions: many }),
      recorder(),
    );

    expect(labels(template)).toEqual(['a', 'b', 'c', 'd', 'e', '---', 'Add to Dictionary', '---', 'paste']);
  });

  it('offers only the clipboard actions the selection actually allows', () => {
    const selectedInProse = target({ editFlags: { canCut: true, canCopy: true, canPaste: true } });
    expect(labels(buildContextMenuTemplate(selectedInProse, recorder()))).toEqual(['cut', 'copy', 'paste']);

    // Selected text on a read-only page.
    const selectedInReading = target({ editFlags: { canCut: false, canCopy: true, canPaste: false } });
    expect(labels(buildContextMenuTemplate(selectedInReading, recorder()))).toEqual(['copy']);
  });

  /** So a right-click on a Hex Map or an empty Board canvas stays a gesture those surfaces own. */
  it('puts up no menu at all when it has nothing to offer', () => {
    expect(buildContextMenuTemplate(target(), recorder())).toEqual([]);
  });

  it('never ends on a separator', () => {
    for (const clicked of [
      target(),
      inProse({ misspelledWord: 'x', dictionarySuggestions: ['y'] }),
      target({ misspelledWord: 'x', dictionarySuggestions: ['y'] }),
      target({ editFlags: { canCut: false, canCopy: true, canPaste: false } }),
    ]) {
      const template = buildContextMenuTemplate(clicked, recorder());
      expect(template.at(-1)?.type).not.toBe('separator');
      expect(template.at(0)?.type).not.toBe('separator');
    }
  });
});
