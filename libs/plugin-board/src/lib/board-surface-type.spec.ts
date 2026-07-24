import { resolveEffectiveFields } from '@hexly/domain';
import { CONTENT_FIELD, tiptapContent } from '@hexly/plugin-content';
import {
  BoardElement,
  BoardSurface,
  emptyBoardSurface,
  EmbedElement,
  ImageElement,
  TextElement,
} from './board-surface';
import { BOARD_SURFACE_DATA_TYPE, CORE_BOARD_SURFACE, SURFACE_FIELD } from './board-surface-type';
import { CORE_BOARD_TYPE } from './board-type';

/** A surface holding `elements` — geometry the harvest ignores, so kept minimal. */
const surface = (elements: BoardElement[]): BoardSurface => ({ elements });

const geometry = { position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, z: 0 } as const;

const image = (id: string, assetUrl: string): ImageElement => ({
  id,
  kind: 'image',
  assetUrl,
  lockRatio: false,
  ...geometry,
});
const embed = (id: string, targetEntityId: string): EmbedElement => ({
  id,
  kind: 'embed',
  targetEntityId,
  viewInstance: '',
  ...geometry,
});
/** A Text Block whose prose is `text` and which links each id in `links` inline. */
const text = (id: string, prose: string, links: string[] = []): TextElement => ({
  id,
  kind: 'text',
  content: tiptapContent({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: prose }] },
      ...links.map((entityId) => ({ type: 'entityLink', attrs: { entityId, label: entityId } })),
    ],
  }),
  ...geometry,
});

describe('the core.datatype.board-surface Structured Data Type (ADR-0050, #263)', () => {
  it('mints a blank plane — no elements', () => {
    expect(BOARD_SURFACE_DATA_TYPE.empty()).toEqual({ elements: [] });
  });

  it('projects to frontmatter and harvests no facets (user story 52)', () => {
    // The whole element model rides the YAML as a nested Field value (ADR-0051); a Board counts no facets.
    expect(BOARD_SURFACE_DATA_TYPE.vault?.slot).toBe('frontmatter');
    expect(BOARD_SURFACE_DATA_TYPE.facetDimensions).toBeUndefined();
    expect(BOARD_SURFACE_DATA_TYPE.harvestFacets).toBeUndefined();
  });

  it('references the surface Field beside the canonical prose Field by id (ADR-0051, ADR-0054)', () => {
    // The surface is what makes an Entity a Board; the prose Field rides alongside so a board carries lore.
    expect(CORE_BOARD_TYPE.fieldRefs).toEqual([CONTENT_FIELD.id, SURFACE_FIELD.id]);
    const byId = new Map([CONTENT_FIELD, SURFACE_FIELD].map((field) => [field.id, field]));
    const fields = resolveEffectiveFields({
      types: [CORE_BOARD_TYPE.id],
      doc: {},
      fieldResolver: (id) => byId.get(id),
      typeFieldRefs: () => CORE_BOARD_TYPE.fieldRefs,
    });
    expect(fields.map((field) => field.id)).toEqual([CONTENT_FIELD.id, SURFACE_FIELD.id]);
    expect(SURFACE_FIELD).toMatchObject({
      id: 'core.field.surface',
      dataType: { kind: CORE_BOARD_SURFACE },
      facetable: false,
    });
  });

  describe('harvestEdges', () => {
    it('harvests every Embed target and every Text Block inline link as descriptor-less edges', () => {
      const edges = BOARD_SURFACE_DATA_TYPE.harvestEdges?.(
        surface([
          image('i1', 'https://assets/harbour.png'),
          embed('e1', 'riverbend'),
          embed('e2', 'the-keep'),
          text('t1', 'See ', ['avalon', 'the-whisperwood']),
        ]),
      );

      // Embeds and Text Block links are always semantic (ADR-0069) — curatorial acts and authored meaning.
      expect(edges).toEqual([
        { targetKind: 'entity', targetId: 'riverbend', descriptor: null, decor: false },
        { targetKind: 'entity', targetId: 'the-keep', descriptor: null, decor: false },
        { targetKind: 'entity', targetId: 'avalon', descriptor: null, decor: false },
        { targetKind: 'entity', targetId: 'the-whisperwood', descriptor: null, decor: false },
      ]);
    });

    it('harvests an Image element’s Asset as a decor content-addressed asset edge (ADR-0065/0069, #277)', () => {
      const hash = 'a'.repeat(64);
      const edges = BOARD_SURFACE_DATA_TYPE.harvestEdges?.(
        surface([image('i1', `/assets/world-1/${hash}.png`), embed('e1', 'riverbend')]),
      );

      // A Board Image is a capability-URL reference — decor by construction (ADR-0069). The Embed's entity
      // edge is semantic and rides alongside, order-preserved.
      expect(edges).toEqual([
        { targetKind: 'asset', targetId: hash, descriptor: null, decor: true },
        { targetKind: 'entity', targetId: 'riverbend', descriptor: null, decor: false },
      ]);
    });

    it('harvests nothing from a non-Asset image src, an unlinked plane, or a malformed value at rest', () => {
      // A non-Asset src (external URL, not a content address) resolves to no hash and so no edge.
      expect(BOARD_SURFACE_DATA_TYPE.harvestEdges?.(surface([image('i1', 'https://assets/a.png')]))).toEqual([]);
      expect(BOARD_SURFACE_DATA_TYPE.harvestEdges?.(surface([text('t1', 'plain prose')]))).toEqual([]);
      // Forward-only (ADR-0048): a document this build cannot parse yields no edges rather than throwing.
      expect(BOARD_SURFACE_DATA_TYPE.harvestEdges?.('garbage')).toEqual([]);
    });
  });

  describe('extractText', () => {
    it('yields exactly the Text Block prose, joined', () => {
      const result = BOARD_SURFACE_DATA_TYPE.extractText?.(
        surface([
          image('i1', 'https://assets/a.png'),
          embed('e1', 'riverbend'),
          text('t1', 'The Whisperwood'),
          text('t2', 'The Kingdom of Avalon'),
        ]),
      );

      expect(result).toBe('The Whisperwood The Kingdom of Avalon');
    });

    it('yields nothing from an image/embed-only plane, or a malformed value at rest', () => {
      expect(BOARD_SURFACE_DATA_TYPE.extractText?.(surface([embed('e1', 'riverbend')]))).toBe('');
      expect(BOARD_SURFACE_DATA_TYPE.extractText?.(emptyBoardSurface())).toBe('');
      expect(BOARD_SURFACE_DATA_TYPE.extractText?.('garbage')).toBe('');
    });
  });
});
