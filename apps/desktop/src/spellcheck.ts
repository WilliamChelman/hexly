/** The language to check in when the user's own has no dictionary (ADR-0070). */
export const FALLBACK_LANGUAGE = 'en-US';

/**
 * Which languages the spellchecker runs with, given the user's locale and the dictionaries Chromium has.
 * Exactly one, not a union: a second enabled dictionary makes every word it knows correct, which for an
 * invented-name-heavy vocabulary stops the checker being useful. Empty when Chromium has none of them, since
 * `setSpellCheckerLanguages` throws on a language it cannot load.
 */
export function spellCheckerLanguages(locale: string, available: readonly string[]): readonly string[] {
  const language = bestMatch(locale, available) ?? bestMatch(FALLBACK_LANGUAGE, available);
  return language ? [language] : [];
}

function bestMatch(locale: string, available: readonly string[]): string | undefined {
  const wanted = locale.replace('_', '-');
  const base = wanted.split('-')[0].toLowerCase();
  return (
    available.find((candidate) => candidate.toLowerCase() === wanted.toLowerCase()) ??
    available.find((candidate) => candidate.toLowerCase().split('-')[0] === base)
  );
}

/** As much of Electron's `Session` as turning the spellchecker on needs, so a spec can stand in for one. */
export interface SpellCheckerSession {
  readonly availableSpellCheckerLanguages: string[];
  setSpellCheckerLanguages(languages: string[]): void;
}

/**
 * Turn the spellchecker on for `locale`. Session-wide, so it covers every editable surface a window has rather
 * than being wired per component. Effectively a no-op on macOS, where the OS spellchecker picks its own
 * language.
 */
export function enableSpellChecker(session: SpellCheckerSession, locale: string): readonly string[] {
  const languages = spellCheckerLanguages(locale, session.availableSpellCheckerLanguages);
  if (languages.length) session.setSpellCheckerLanguages([...languages]);
  return languages;
}
