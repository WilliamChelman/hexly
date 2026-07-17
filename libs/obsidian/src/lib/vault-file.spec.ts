import { z } from 'zod';
import {
  defineStructuredDataType,
  Field,
  fieldSchema,
  structuredDataTypeSet,
  VaultExportContext,
  VaultImportContext,
} from '@hexly/domain';
import { bodyToFields, entityToMarkdown, splitFrontmatter } from './vault-file';

/**
 * A stand-in body data-type. Its converters are `libs/obsidian`'s test-double for `core.rich-content`:
 * the projection round-trip proven here is the vault layer's marker / frontmatter / omit handling, not
 * any Markdown grammar (that lives with the converter, in `@hexly/plugin-content`). The value is
 * `{ text }`; `toMarkdown` unwraps it and `fromMarkdown` re-wraps, so a body block is `text` verbatim.
 */
const PROSE = defineStructuredDataType({
  id: 'test.prose',
  valueSchema: z.object({ text: z.string() }),
  empty: () => ({ text: '' }),
  vault: {
    slot: 'body',
    toMarkdown: (value) => (value as { text?: string })?.text ?? '',
    // A real converter (markdownToProseMirror) ignores surrounding whitespace; the double trims to say so.
    fromMarkdown: (markdown) => ({ text: markdown.trim() }),
  },
});

/** A stand-in frontmatter data-type (a grid): no converter, so it rides the YAML as-is. */
const GRID = defineStructuredDataType({
  id: 'test.grid',
  valueSchema: z.record(z.string(), z.unknown()),
  empty: () => ({}),
  vault: { slot: 'frontmatter' },
});

/** A stand-in that is written nowhere. */
const SECRET_NOTE = defineStructuredDataType({
  id: 'test.omit',
  valueSchema: z.unknown(),
  empty: () => null,
  vault: { slot: 'omit', toMarkdown: () => 'should never appear' },
});

const DATA_TYPES = structuredDataTypeSet([PROSE, GRID, SECRET_NOTE]);

function field(partial: Partial<Field> & Pick<Field, 'id' | 'dataType'>): Field {
  return fieldSchema.parse({ label: partial.id, ...partial });
}

const CONTENT = field({ id: 'test.content', dataType: { kind: 'test.prose' } });
const SECRETS = field({ id: 'test.secrets', dataType: { kind: 'test.prose' } });
const GRID_FIELD = field({ id: 'test.grid', dataType: { kind: 'test.grid' } });
const OMITTED = field({ id: 'test.draft', dataType: { kind: 'test.omit' } });

const exportCtx: VaultExportContext = { entityName: () => undefined, assetPath: () => undefined };
const importCtx: VaultImportContext = { resolveLink: () => null, storeAsset: () => null, degrade: () => undefined };

describe('vault-file — the projection round-trip (ADR-0051)', () => {
  describe('one body Field → a plain file, no marker', () => {
    it('writes the body with no marker comment', () => {
      const md = entityToMarkdown({
        doc: { 'test.content': { text: 'A ranger of the north.' } },
        fields: [CONTENT],
        dataTypes: DATA_TYPES,
        frontmatter: {},
        context: exportCtx,
      });
      expect(md).toBe('A ranger of the north.');
      expect(md).not.toContain('hexly:field');
    });

    it('re-imports the unmarked body into the single body Field', () => {
      const values = bodyToFields({
        body: 'A ranger of the north.',
        fields: [CONTENT],
        dataTypes: DATA_TYPES,
        context: importCtx,
      });
      expect(values).toEqual({ 'test.content': { text: 'A ranger of the north.' } });
    });
  });

  describe('two body Fields → markers in Field order, lossless round trip', () => {
    const doc = { 'test.content': { text: 'Public lore.' }, 'test.secrets': { text: 'Hidden truth.' } };

    it('precedes each block with its marker, in Field order', () => {
      const md = entityToMarkdown({
        doc,
        fields: [CONTENT, SECRETS],
        dataTypes: DATA_TYPES,
        frontmatter: {},
        context: exportCtx,
      });
      expect(md).toBe(
        '<!-- hexly:field test.content -->\nPublic lore.\n\n<!-- hexly:field test.secrets -->\nHidden truth.',
      );
    });

    it('lands each block back in the Field it came from', () => {
      const md = entityToMarkdown({
        doc,
        fields: [CONTENT, SECRETS],
        dataTypes: DATA_TYPES,
        frontmatter: {},
        context: exportCtx,
      });
      const values = bodyToFields({ body: md, fields: [CONTENT, SECRETS], dataTypes: DATA_TYPES, context: importCtx });
      expect(values).toEqual(doc);
    });

    it('marks a lone non-first body value so it re-imports into its own Field', () => {
      // Only `secrets` has a value: unmarked, it would land in the first body Field (content), so it
      // must carry a marker.
      const md = entityToMarkdown({
        doc: { 'test.secrets': { text: 'Hidden truth.' } },
        fields: [CONTENT, SECRETS],
        dataTypes: DATA_TYPES,
        frontmatter: {},
        context: exportCtx,
      });
      expect(md).toContain('<!-- hexly:field test.secrets -->');
      const values = bodyToFields({ body: md, fields: [CONTENT, SECRETS], dataTypes: DATA_TYPES, context: importCtx });
      expect(values).toEqual({ 'test.secrets': { text: 'Hidden truth.' } });
    });
  });

  describe('a marked block whose Field this build does not resolve is preserved, not dropped', () => {
    it('stores an unresolved marked key via the first body Field’s converter', () => {
      // A vault exported from a World that declared `secrets`; here only `content` resolves.
      const md = '<!-- hexly:field test.content -->\nPublic.\n\n<!-- hexly:field test.secrets -->\nHidden.';
      const values = bodyToFields({ body: md, fields: [CONTENT], dataTypes: DATA_TYPES, context: importCtx });
      expect(values).toEqual({ 'test.content': { text: 'Public.' }, 'test.secrets': { text: 'Hidden.' } });
    });
  });

  describe('an unmarked foreign body lands in the first body Field', () => {
    it('routes a hand-written note into content even with two body Fields declared', () => {
      const values = bodyToFields({
        body: 'Just some prose a stranger wrote.',
        fields: [CONTENT, SECRETS],
        dataTypes: DATA_TYPES,
        context: importCtx,
      });
      expect(values).toEqual({ 'test.content': { text: 'Just some prose a stranger wrote.' } });
    });
  });

  describe('a frontmatter Field rides the YAML (ADR-0050 not regressed)', () => {
    const grid = { hexes: { '0,0': { terrain: 'forest' } }, regions: [], labels: [] };

    it('serializes the grid as nested frontmatter and keeps the body prose separate', () => {
      const md = entityToMarkdown({
        doc: { 'test.content': { text: 'The frontier.' }, 'test.grid': grid },
        fields: [CONTENT, GRID_FIELD],
        dataTypes: DATA_TYPES,
        frontmatter: {},
        context: exportCtx,
      });
      const { frontmatter, body } = splitFrontmatter(md);
      expect(frontmatter).toEqual({ 'test.grid': grid });
      expect(body.trim()).toBe('The frontier.');
      // The grid is not a body Field, so no marker even though a second Field exists.
      expect(md).not.toContain('hexly:field');
    });
  });

  describe('an omit Field is written nowhere', () => {
    it('leaves the omitted value out of both body and frontmatter', () => {
      const md = entityToMarkdown({
        doc: { 'test.content': { text: 'Visible.' }, 'test.draft': { anything: true } },
        fields: [CONTENT, OMITTED],
        dataTypes: DATA_TYPES,
        frontmatter: {},
        context: exportCtx,
      });
      expect(md).toBe('Visible.');
      expect(md).not.toContain('should never appear');
      expect(md).not.toContain('draft');
    });
  });

  describe('frontmatter split and Entity-level additions', () => {
    it('emits non-reserved EntityDocument keys and merged additions, dropping hexly.*', () => {
      const md = entityToMarkdown({
        doc: { 'test.content': { text: 'x' }, status: 'alive', 'hexly.sourcePath': 'a/b.md' },
        fields: [CONTENT],
        dataTypes: DATA_TYPES,
        frontmatter: { tags: ['deity'], 'hexly.type': ['core.note', 'dnd.monster'] },
        context: exportCtx,
      });
      const { frontmatter } = splitFrontmatter(md);
      expect(frontmatter).toEqual({ status: 'alive', tags: ['deity'], 'hexly.type': ['core.note', 'dnd.monster'] });
      expect(md).not.toContain('hexly.sourcePath');
    });

    it('degrades a non-map frontmatter to empty, tallied', () => {
      expect(splitFrontmatter('---\n- just\n- a\n- list\n---\nbody')).toEqual({
        frontmatter: {},
        body: 'body',
        degraded: { frontmatter: 1 },
      });
    });

    it('returns the whole file as body when there is no frontmatter block', () => {
      expect(splitFrontmatter('# Just a note\n\nprose')).toEqual({
        frontmatter: {},
        body: '# Just a note\n\nprose',
        degraded: {},
      });
    });
  });
});
