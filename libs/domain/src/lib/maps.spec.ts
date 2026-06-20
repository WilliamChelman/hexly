import { emptyHexMap } from './hex/hex-map';
import {
  createMapRequestSchema,
  renameMapRequestSchema,
  saveMapRequestSchema,
} from './maps';

describe('createMapRequestSchema', () => {
  it('accepts a request that names the map', () => {
    const body = { title: 'The Reach of Aldermoor' };

    expect(createMapRequestSchema.parse(body).title).toBe(
      'The Reach of Aldermoor',
    );
  });

  it('rejects a request with an empty title', () => {
    expect(() => createMapRequestSchema.parse({ title: '' })).toThrow();
  });

  it('rejects a whitespace-only title', () => {
    // `.trim()` collapses "   " to "" before `.min(1)`, closing the gap a bare
    // `z.string().min(1)` left open (issues #12, #15).
    expect(() => createMapRequestSchema.parse({ title: '   ' })).toThrow();
  });

  it('trims surrounding whitespace off the stored title', () => {
    expect(createMapRequestSchema.parse({ title: '  Aldermoor  ' }).title).toBe(
      'Aldermoor',
    );
  });
});

describe('renameMapRequestSchema', () => {
  it('accepts a new, non-empty title', () => {
    expect(renameMapRequestSchema.parse({ title: 'Aldermoor' }).title).toBe(
      'Aldermoor',
    );
  });

  it('rejects an empty title', () => {
    expect(() => renameMapRequestSchema.parse({ title: '' })).toThrow();
  });

  it('rejects a whitespace-only title', () => {
    expect(() => renameMapRequestSchema.parse({ title: '   ' })).toThrow();
  });
});

describe('saveMapRequestSchema', () => {
  it('carries the document and the base version the save is built on', () => {
    const body = { document: emptyHexMap(), version: 3 };

    expect(saveMapRequestSchema.parse(body)).toEqual(body);
  });

  it('rejects a save that omits the base version', () => {
    expect(() =>
      saveMapRequestSchema.parse({ document: emptyHexMap() }),
    ).toThrow();
  });

  it('rejects a save whose document is not a valid Hex Map', () => {
    expect(() =>
      saveMapRequestSchema.parse({
        document: { hexes: { '0,0': { terrain: 'lava' } } },
        version: 1,
      }),
    ).toThrow();
  });
});
