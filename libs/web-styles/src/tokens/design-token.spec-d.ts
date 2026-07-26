import { describe, expectTypeOf, it } from 'vitest';
import { DesignToken, PublicDesignToken } from './manifest';

/**
 * `DesignToken` is the union of every declared name, which is what closes the bare-string token
 * references `no-unknown-design-token` structurally cannot see (ADR-0075). It only earns that if a
 * typo fails to compile, so the assertion has to be a type-level one.
 */
describe('DesignToken', () => {
  it('admits a declared name and rejects a typo', () => {
    expectTypeOf<'--color-accent'>().toExtend<DesignToken>();
    expectTypeOf<'--color-terrain-sky'>().toExtend<DesignToken>();
    // @ts-expect-error — '--color-acccent' is not a declared token.
    const typo: DesignToken = '--color-acccent';
    expectTypeOf(typo).toEqualTypeOf<DesignToken>();
  });

  it('is a closed union, not a widened string', () => {
    expectTypeOf<string>().not.toExtend<DesignToken>();
  });

  it('narrows to the World Theme contract, which a tier-3 token is outside of', () => {
    expectTypeOf<PublicDesignToken>().toExtend<DesignToken>();
    expectTypeOf<'--color-accent'>().toExtend<PublicDesignToken>();
    expectTypeOf<'--color-terrain-sky'>().not.toExtend<PublicDesignToken>();
    expectTypeOf<'--dur-fast'>().not.toExtend<PublicDesignToken>();
  });
});
