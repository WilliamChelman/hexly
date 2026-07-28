// @vitest-environment jsdom
// The lib's own tests run in node; this one needs a `document` to have no stylesheets *in*.
import { describe, expect, it } from 'vitest';
import { declaredTokenValues, tokenDerivation } from './declared';

/**
 * Reading a token's *declaration* rather than its value (ADR-0075). The CSSOM half needs a real engine
 * and a real stylesheet, so `world-theme-overrides.spec.ts` owns it; what is testable here is the
 * classifier the Theme editor marks its rows with, and that the reader is silent where jsdom is.
 *
 * Every `var(--…)` below is a fixture rather than a style, which is why `no-unknown-design-token`
 * names this file as its one outright exemption: a tier-1 anchor is the reference the classifier
 * exists to recognise, and an undeclared name the one it has to refuse.
 */
describe('where a token gets its value', () => {
  it('reads a whole-value var() as the token it renames', () => {
    const from = tokenDerivation('var(--palette-page)');

    expect(from.kind).toBe('anchor');
    expect(from.sources).toEqual(['--palette-page']);
  });

  it('reads a colour function over an anchor as a derivation, and names what it reads', () => {
    const from = tokenDerivation('oklch(from var(--palette-page) calc(l + 0.067 * var(--palette-polarity)) c h)');

    expect(from.kind).toBe('derived');
    expect(from.sources).toEqual(['--palette-page', '--palette-polarity']);
  });

  it('reads a derivation over another role, which names no anchor at all', () => {
    const from = tokenDerivation('oklch(from var(--color-tone-1) l c h / 0.14)');

    expect(from.kind).toBe('derived');
    expect(from.sources).toEqual(['--color-tone-1']);
  });

  it('reads a stated value as a literal — no anchor reaches it', () => {
    expect(tokenDerivation('rgba(255, 240, 202, 0.55)').kind).toBe('literal');
  });

  /** ADR-0075's own reading: the material is composed from its stops, so it is exactly what it says. */
  it('reads a gradient naming its two stops as a literal rather than a derivation', () => {
    const from = tokenDerivation(
      'linear-gradient(180deg, var(--color-accent-sheen-bright), var(--color-accent-sheen-deep))',
    );

    expect(from.kind).toBe('literal');
  });

  it('shows a declaration in one shape, whatever spacing the engine re-serialised it with', () => {
    // Chrome hands back `oklch( from …` with the padding it chose; the argument spaces are the value's.
    const serialised = 'oklch(  from var(--palette-soot) l\n  c h / var(--palette-veil) )';

    expect(tokenDerivation(serialised).formula).toBe('oklch(from var(--palette-soot) l c h / var(--palette-veil))');
  });

  it('names only tokens the manifest declares, so a stray var() cannot be shown as one', () => {
    expect(tokenDerivation('oklch(from var(--not-a-token) l c h)').sources).toEqual([]);
  });

  it('answers with nothing where no stylesheet is reachable, rather than throwing', () => {
    expect(declaredTokenValues('light')).toEqual({});
  });
});
