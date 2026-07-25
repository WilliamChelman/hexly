import { enableSpellChecker, FALLBACK_LANGUAGE, type SpellCheckerSession, spellCheckerLanguages } from './spellcheck';

/** A slice of what Chromium ships, enough to tell an exact match from a dialect one. */
const AVAILABLE = ['de', 'en-AU', 'en-GB', 'en-US', 'es-ES', 'fr', 'pt-BR', 'pt-PT'];

function fakeSession(available: string[] = AVAILABLE): SpellCheckerSession & { readonly set: string[][] } {
  const set: string[][] = [];
  return { availableSpellCheckerLanguages: available, set, setSpellCheckerLanguages: (l) => void set.push(l) };
}

describe('spellCheckerLanguages', () => {
  it('takes the locale exactly when there is a dictionary for that dialect', () => {
    expect(spellCheckerLanguages('en-GB', AVAILABLE)).toEqual(['en-GB']);
    expect(spellCheckerLanguages('fr', AVAILABLE)).toEqual(['fr']);
  });

  it('falls back to another dialect of the same language', () => {
    // No `fr-CA` dictionary, but a French one is far better than an English one.
    expect(spellCheckerLanguages('fr-CA', AVAILABLE)).toEqual(['fr']);
    expect(spellCheckerLanguages('de-AT', AVAILABLE)).toEqual(['de']);
  });

  it('reads a POSIX-style locale and an odd case the same way', () => {
    expect(spellCheckerLanguages('pt_PT', AVAILABLE)).toEqual(['pt-PT']);
    expect(spellCheckerLanguages('EN-gb', AVAILABLE)).toEqual(['en-GB']);
  });

  it('checks in English when the locale has no dictionary at all', () => {
    expect(spellCheckerLanguages('ja', AVAILABLE)).toEqual([FALLBACK_LANGUAGE]);
    expect(spellCheckerLanguages('', AVAILABLE)).toEqual([FALLBACK_LANGUAGE]);
  });

  /**
   * One language, never a union: a second dictionary makes every word *it* knows correct too, which for a
   * vocabulary full of invented names quietly stops the checker finding anything.
   */
  it('never enables more than one language', () => {
    for (const locale of ['en-GB', 'fr-CA', 'ja', 'pt_PT']) {
      expect(spellCheckerLanguages(locale, AVAILABLE)).toHaveLength(1);
    }
  });

  it('says nothing when Chromium has no dictionaries to offer', () => {
    expect(spellCheckerLanguages('en-GB', [])).toEqual([]);
  });
});

describe('enableSpellChecker', () => {
  it('sets the language on the session, so every editable surface a window has is covered', () => {
    const session = fakeSession();

    expect(enableSpellChecker(session, 'en-GB')).toEqual(['en-GB']);

    expect(session.set).toEqual([['en-GB']]);
  });

  /** `setSpellCheckerLanguages` throws on a language it cannot load, so an empty list must not be passed on. */
  it('asks for nothing rather than for a language that cannot be loaded', () => {
    const session = fakeSession([]);

    expect(enableSpellChecker(session, 'en-GB')).toEqual([]);

    expect(session.set).toEqual([]);
  });
});
