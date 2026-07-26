import { describe, expect, it } from 'vitest';
import { designToken } from './manifest';
import { designTokenInitial, readDesignToken } from './read-token';

/** A `CSSStyleDeclaration` stand-in: only `getPropertyValue` is ever reached. */
function styleOf(values: Record<string, string>): CSSStyleDeclaration {
  return { getPropertyValue: (name: string) => values[name] ?? '' } as CSSStyleDeclaration;
}

describe('designTokenInitial', () => {
  it('answers with the value the manifest declares', () => {
    expect(designTokenInitial('--color-accent')).toBe(designToken('--color-accent')?.initial);
    expect(designTokenInitial('--radius-md')).toBe('6px');
  });
});

describe('readDesignToken', () => {
  it('prefers what the document resolved', () => {
    expect(readDesignToken(styleOf({ '--color-accent': ' #123456 ' }), '--color-accent')).toBe('#123456');
  });

  it('falls back to the declared initial where nothing resolves', () => {
    // A registered property always resolves in a browser (ADR-0075); jsdom is the environment that
    // does not, and that is exactly where a hand-written hex fallback used to go stale.
    expect(readDesignToken(styleOf({}), '--color-accent')).toBe(designTokenInitial('--color-accent'));
  });
});
