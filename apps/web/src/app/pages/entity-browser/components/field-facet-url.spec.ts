import { fieldTokens, fieldsFromTokens, pruneField } from './field-facet-url';

/**
 * The `field` param's codec, shared by the Entity Browser, the Asset Browser, the Library and the
 * Compendium browse — so a token it misreads is misread on four surfaces at once.
 */
describe('field-facet-url — the `key:op:value` round trip', () => {
  it('round-trips the ops the rail has controls for', () => {
    const tokens = ['alignment:eq:lawful-good', 'size:neq:large', 'cr:gte:5', 'cr:lte:9'];
    expect(fieldTokens(fieldsFromTokens(tokens, true)).sort()).toEqual(tokens.slice().sort());
  });

  // ADR-0081 widened the grammar with `neq` — an exclusion, never the range bound it is not.
  it('decodes a `neq` as an exclusion, not a bound', () => {
    const decoded = fieldsFromTokens(['size:neq:large'], true);
    expect(decoded['size']?.excluded).toEqual(['large']);
    expect(decoded['size']?.lte).toBeUndefined();
    expect(decoded['size']?.gte).toBeUndefined();
  });

  it('carries both polarities of one key on the same param', () => {
    const decoded = fieldsFromTokens(['size:eq:small', 'size:neq:large'], true);
    expect(decoded['size']).toEqual({ values: ['small'], excluded: ['large'] });
  });

  /** The dual of "the rail never renders a lit control that is not in force": a browse with no
   * exclude control must not filter by a veto its reader cannot release (#423). */
  it('drops a `neq` on a browse that renders no exclude control, keeping the rest of the key', () => {
    const decoded = fieldsFromTokens(['size:eq:small', 'size:neq:large']);
    expect(decoded['size']).toEqual({ values: ['small'] });
    expect(fieldsFromTokens(['size:neq:large'])).toEqual({});
  });

  /**
   * The active-facet signals compare by JSON, so a decoded selection and the toggle that caused it
   * must spell themselves identically or every toggle costs a second fetch on the URL echo.
   */
  it('decodes to the same shape pruneField writes, so the URL echo reads as no change', () => {
    for (const tokens of [['size:eq:small'], ['size:neq:large'], ['size:gte:1'], ['size:eq:small', 'size:lte:9']]) {
      const decoded = fieldsFromTokens(tokens, true)['size'];
      expect(JSON.stringify(pruneField(decoded))).toBe(JSON.stringify(decoded));
    }
  });

  it('drops a selection emptied in both polarities', () => {
    expect(pruneField({ values: [], excluded: [] })).toBeUndefined();
    expect(pruneField({ values: [], excluded: ['large'] })).toEqual({ values: [], excluded: ['large'] });
  });
});
