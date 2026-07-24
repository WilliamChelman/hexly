import { vocabItems } from './vocab-items';

describe('vocabItems — vocabulary filter + typed free text', () => {
  const vocab = ['capital of', 'rival', 'spouse'];

  it('filters the vocabulary by a case-insensitive substring', () => {
    const matches = vocabItems('iv', vocab).filter((i) => !i.isNew);
    expect(matches.map((i) => i.value)).toEqual(['rival']);
  });

  it('offers the typed text as a brand-new entry when it matches nothing', () => {
    const items = vocabItems('mentor', vocab);
    expect(items[0]).toEqual({
      id: expect.any(String),
      value: 'mentor',
      isNew: true,
    });
  });

  it('does not duplicate an existing entry as a "new" one (case-folded)', () => {
    const items = vocabItems('Spouse', vocab);
    expect(items.filter((i) => i.isNew)).toEqual([]);
    expect(items.map((i) => i.value)).toEqual(['spouse']);
  });

  it('lists the whole vocabulary and offers no new entry for an empty query', () => {
    const items = vocabItems('   ', vocab);
    expect(items.every((i) => !i.isNew)).toBe(true);
    expect(items.map((i) => i.value)).toEqual(vocab);
  });
});
