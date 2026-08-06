import { fieldTokens, fieldsFromTokens } from './field-facet-url';

/**
 * The `field` param's codec, shared by the Entity Browser, the Asset Browser, the Library and the
 * Compendium browse — so a token it misreads is misread on four surfaces at once.
 */
describe('field-facet-url — the `key:op:value` round trip', () => {
  it('round-trips the ops the rail has controls for', () => {
    const tokens = ['alignment:eq:lawful-good', 'cr:gte:5', 'cr:lte:9'];
    expect(fieldTokens(fieldsFromTokens(tokens)).sort()).toEqual(tokens.slice().sort());
  });

  // ADR-0081 widened the grammar with `neq`; the rail grows its control in #422. Until then the codec
  // must leave an exclusion alone rather than fold it into the range bound it is not.
  it('does not mistake a `neq` for a bound', () => {
    const decoded = fieldsFromTokens(['size:neq:large']);
    expect(decoded['size']?.lte).toBeUndefined();
    expect(decoded['size']?.gte).toBeUndefined();
    expect(fieldTokens(decoded)).toEqual([]);
  });
});
