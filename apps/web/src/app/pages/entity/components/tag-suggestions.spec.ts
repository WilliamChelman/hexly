import { tagItems } from './tag-suggestions';

describe('tagItems — Tag entry suggestions', () => {
  const vocab = ['deity', 'demigod', 'northern reach', 'ruined'];

  it('filters the owner vocabulary by a case-insensitive substring', () => {
    const matches = tagItems('DE', vocab, []).filter((i) => !i.isNew);
    expect(matches.map((i) => i.tag)).toEqual(['deity', 'demigod']);
  });

  it('excludes tags already on the entity', () => {
    const matches = tagItems('de', vocab, ['deity']).filter((i) => !i.isNew);
    expect(matches.map((i) => i.tag)).toEqual(['demigod']);
  });

  it('offers the typed text as a brand-new tag when it matches nothing', () => {
    const items = tagItems('undead', vocab, []);
    expect(items[0]).toEqual({
      id: expect.any(String),
      tag: 'undead',
      isNew: true,
    });
  });

  it('does not offer a "new" row when the typed text already exists (case-folded)', () => {
    const items = tagItems('Deity', vocab, []);
    expect(items.filter((i) => i.isNew)).toEqual([]);
    expect(items.map((i) => i.tag)).toEqual(['deity']);
  });

  it('never offers an existing/added tag as "new" — typing it yields nothing', () => {
    // 'deity' exists but is added: no vocab match survives the exclusion, and an existing
    // tag is never offered as "new", so the pool is empty.
    expect(tagItems('deity', vocab, ['deity'])).toEqual([]);
  });

  it('does not offer a no-op "new" row for a just-added tag missing from the saved vocab', () => {
    // 'undead' isn't in the last-saved vocab yet but is already on the entity; the "(new)"
    // row would be a silent no-op (deduped away on pick), so it must not appear.
    expect(tagItems('undead', vocab, ['undead'])).toEqual([]);
  });
});
