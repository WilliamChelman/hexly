/** The language to check in when the user's own has no dictionary — and the one the app's own UI is written in. */
export const FALLBACK_LANGUAGE = 'en-US';

/**
 * Which languages the spellchecker runs with, given the user's locale and the dictionaries Chromium has.
 * Hexly is fundamentally a prose tool, so writing in it should be at least as well served as writing in the
 * browser was (ADR-0070).
 *
 * Exactly one language, not a union: a second enabled dictionary makes every word it knows correct, which for
 * an invented-name-heavy vocabulary quietly stops the checker being useful. The locale's own dialect first
 * (`en-GB` over `en-US`), then any dialect of the same language, then English.
 *
 * Empty when Chromium has none of them — `setSpellCheckerLanguages` throws on a language it cannot load, so
 * "no dictionary" has to be sayable.
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
 * Turn the spellchecker on for `locale` and report the languages it ended up with. Session-wide, so it covers
 * every editable surface a window has — Content, a Board's Text Blocks, and the name fields — rather than
 * being wired per component.
 *
 * A no-op on macOS, where the OS spellchecker is used and picks its own language from what is being typed;
 * calling it anyway keeps one code path and is what every other platform needs.
 */
export function enableSpellChecker(session: SpellCheckerSession, locale: string): readonly string[] {
  const languages = spellCheckerLanguages(locale, session.availableSpellCheckerLanguages);
  if (languages.length) session.setSpellCheckerLanguages([...languages]);
  return languages;
}
