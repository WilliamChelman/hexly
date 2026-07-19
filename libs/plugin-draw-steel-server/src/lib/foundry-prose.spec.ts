import { describe, expect, it } from 'vitest';
import { extractText } from '@hexly/plugin-content';
import { foundryProseToContent, foundryProseToText } from './foundry-prose';

/**
 * The one plain-text converter (#258): resolves Foundry HTML + Draw Steel enricher tokens down to the
 * prose a trait or a biography reads, so no raw `[[…]]` / `{{…}}` / `@chr` token ever survives into an
 * Entity Document. Each token case is pinned here so a regression in one enricher rule is caught in isolation.
 */
describe('foundryProseToText — enricher tokens', () => {
  it('resolves a labelled enricher to its label', () => {
    expect(foundryProseToText('deal [[/damage 20]]{20 damage} to end it')).toBe('deal 20 damage to end it');
    // The label wins even over a resolvable inner (a data path); we never read the path.
    expect(foundryProseToText('a [[/damage @monster.freeStrike]]{Free Strike}')).toBe('a Free Strike');
  });

  it('humanizes a label-less apply of a known condition, folding its end duration', () => {
    expect(foundryProseToText('he is [[/apply bleeding]] now')).toBe('he is bleeding now');
    expect(foundryProseToText('target is [[/apply restrained save]]')).toBe('target is restrained (save ends)');
    expect(foundryProseToText('[[/apply frightened turn]]')).toBe('frightened (EoT)');
  });

  it('strips an unresolvable id-based apply silently', () => {
    // A bare effect id with no committed effect to resolve — dropped, not left as a raw token.
    expect(foundryProseToText('gains [[/apply uBQLDGNoZMc0EYaE]] then acts')).toBe('gains then acts');
    expect(foundryProseToText('[[/apply E8LwdMt2tauxdbOc encounter]] and more').trim()).toBe('and more');
  });

  it('renders a potency token as "characteristic < value"', () => {
    expect(foundryProseToText('[[potency M 3]] the target is slowed')).toBe('M < 3 the target is slowed');
    expect(foundryProseToText('[[potency a 4]]')).toBe('A < 4');
  });

  it('substitutes the potency / forced mustaches and @chr from the supplied context', () => {
    expect(foundryProseToText('{{potency}} the target is dazed', { potency: 'M < 2' })).toBe(
      'M < 2 the target is dazed',
    );
    expect(foundryProseToText('is pushed {{forced}}', { forced: 'a distance equal to 3' })).toBe(
      'is pushed a distance equal to 3',
    );
    expect(foundryProseToText('deals @chr damage', { chr: '5' })).toBe('deals 5 damage');
  });

  it('drops an unsubstituted mustache / @chr rather than leaking the raw token', () => {
    expect(foundryProseToText('a {{potency}} then @chr end').replace(/\s+/g, ' ').trim()).toBe('a then end');
  });
});

describe('foundryProseToText — HTML structure', () => {
  it('preserves paragraph breaks between block elements', () => {
    const html =
      '<p><strong>Ajax Turns: </strong>He takes three turns.</p><p><strong>End Effect: </strong>He can end it.</p>';
    expect(foundryProseToText(html)).toBe('Ajax Turns: He takes three turns.\n\nEnd Effect: He can end it.');
  });

  it('keeps a hard line break inside a block', () => {
    expect(foundryProseToText('<p>first<br>second</p>')).toBe('first\nsecond');
  });

  it('unwraps inline marks and headings, and decodes entities', () => {
    expect(foundryProseToText('<p>a <em>bold</em> claim &amp; a <strong>fact</strong></p>')).toBe(
      'a bold claim & a fact',
    );
    expect(foundryProseToText('<p>Stances:</p><h4>Insurgent</h4><p>Auto 17.</p>')).toBe(
      'Stances:\n\nInsurgent\n\nAuto 17.',
    );
  });

  it('yields empty string for blank / tagless-empty HTML', () => {
    expect(foundryProseToText('<p></p>')).toBe('');
    expect(foundryProseToText('')).toBe('');
    expect(foundryProseToText('   ')).toBe('');
  });

  it('decodes numeric and hex entities, and defers &amp; so a double-encoded entity survives', () => {
    // Hex and decimal numeric references both resolve to the em dash.
    expect(foundryProseToText('<p>an em&#x2014;dash and &#8212; too</p>')).toBe('an em—dash and — too');
    // `&amp;` decodes last: `&amp;lt;` is the literal text `&lt;`, not a `<` (it must not double-decode).
    expect(foundryProseToText('<p>&amp;lt;tag&amp;gt;</p>')).toBe('&lt;tag&gt;');
  });
});

describe('foundryProseToContent', () => {
  it('folds prose into paragraph nodes whose text round-trips through extractText', () => {
    const content = foundryProseToContent('<p>Once a hero.</p><p>Now a tyrant.</p>');
    if (!content) throw new Error('expected content');
    expect(extractText(content)).toContain('Once a hero.');
    expect(extractText(content)).toContain('Now a tyrant.');
  });

  it('is undefined for empty prose, so an empty biography yields no core.content', () => {
    expect(foundryProseToContent('<p></p>')).toBeUndefined();
    expect(foundryProseToContent('')).toBeUndefined();
  });
});
