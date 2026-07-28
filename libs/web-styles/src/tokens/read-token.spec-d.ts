import { describe, expectTypeOf, it } from 'vitest';
import { DesignToken } from './manifest';
import { designTokenInitial, readDesignToken } from './read-token';

/** The reader is the typed door onto a token's value, so a made-up name must not compile (ADR-0075). */
describe('readDesignToken', () => {
  it('takes only a declared name', () => {
    expectTypeOf(readDesignToken).parameter(1).toEqualTypeOf<DesignToken>();
    expectTypeOf(designTokenInitial).parameter(0).toEqualTypeOf<DesignToken>();

    const style = {} as CSSStyleDeclaration;
    // @ts-expect-error — a token renamed out of the manifest must not survive as a bare string.
    readDesignToken(style, '--color-gold');
    // @ts-expect-error — an arbitrary custom property is not a token.
    designTokenInitial('--whatever');
  });
});
