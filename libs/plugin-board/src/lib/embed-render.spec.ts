import { DEFAULT_MAX_EMBED_DEPTH } from './plugin-id';
import { resolveEmbedRender } from './embed-render';

describe('resolveEmbedRender — Embed cycle/depth bounding (ADR-0062, #263)', () => {
  it('transcludes a fresh target within the depth cap', () => {
    expect(resolveEmbedRender('note', [], 0, DEFAULT_MAX_EMBED_DEPTH)).toBe('transclude');
    expect(resolveEmbedRender('note', ['a', 'b'], 2, DEFAULT_MAX_EMBED_DEPTH)).toBe('transclude');
  });

  it('degrades to a card on a cycle — the target already on the render path', () => {
    expect(resolveEmbedRender('board', ['board'], 1, DEFAULT_MAX_EMBED_DEPTH)).toBe('card');
    expect(resolveEmbedRender('board', ['root', 'board', 'other'], 2, DEFAULT_MAX_EMBED_DEPTH)).toBe('card');
  });

  it('degrades to a card once depth reaches the cap', () => {
    expect(resolveEmbedRender('note', [], 3, 3)).toBe('card');
    expect(resolveEmbedRender('note', [], 4, 3)).toBe('card');
    expect(resolveEmbedRender('note', [], 2, 3)).toBe('transclude');
  });

  it('honours a custom (operator-tuned) maxDepth', () => {
    expect(resolveEmbedRender('note', [], 0, 1)).toBe('transclude');
    expect(resolveEmbedRender('note', [], 1, 1)).toBe('card');
  });
});
