import { EntitySummary } from '@hexly/domain';
import { MENTION_CREATE_ID, mentionItems, parseMentionQuery } from './mention-items';

const summary = (id: string, name: string): EntitySummary =>
  ({ id, name, types: ['core.type.note'], tags: [] }) as unknown as EntitySummary;

describe('parseMentionQuery — the name and the Link Descriptor typed in one breath', () => {
  it('reads a bare name, with no descriptor', () => {
    expect(parseMentionQuery('Zorblax')).toEqual({ name: 'Zorblax', descriptor: null });
  });

  it('splits `Name::descriptor` at the first ::', () => {
    expect(parseMentionQuery('Zorblax::rival')).toEqual({ name: 'Zorblax', descriptor: 'rival' });
  });

  it('keeps multi-word names and descriptors, trimmed', () => {
    expect(parseMentionQuery(' Jane Doe :: capital of ')).toEqual({ name: 'Jane Doe', descriptor: 'capital of' });
  });

  it('reads a trailing :: as no descriptor yet, not an empty one', () => {
    expect(parseMentionQuery('Zorblax::')).toEqual({ name: 'Zorblax', descriptor: null });
  });
});

describe('mentionItems — the picker rows', () => {
  it('offers Create below the matches, so an existing name never blocks authoring another', () => {
    const items = mentionItems({ name: 'Jane Doe', descriptor: null }, [summary('e1', 'Jane Doe')]);

    expect(items.map((i) => i.kind)).toEqual(['entity', 'create']);
    expect(items[1]).toMatchObject({ id: MENTION_CREATE_ID, name: 'Jane Doe' });
  });

  it('makes Create the only — hence the active — row when nothing matches', () => {
    const items = mentionItems({ name: 'Zorblax', descriptor: null }, []);

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('create');
  });

  it('offers no Create row for an empty name — there is nothing to mint', () => {
    expect(mentionItems({ name: '', descriptor: null }, [])).toEqual([]);
    expect(mentionItems({ name: '', descriptor: 'rival' }, [summary('e1', 'Jane')])).toHaveLength(1);
  });

  it('carries the typed descriptor onto every row, matched or minted', () => {
    const items = mentionItems({ name: 'Zorblax', descriptor: 'rival' }, [summary('e1', 'Zorblax the Devourer')]);

    expect(items.map((i) => i.descriptor)).toEqual(['rival', 'rival']);
  });
});
