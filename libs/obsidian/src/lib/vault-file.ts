/**
 * The vault ⇆ EntityDocument layer (ADR-0033, ADR-0051). `libs/obsidian` keeps the file walk, the YAML
 * frontmatter, and the marker convention, and resolves each Field's **Vault Projection** off the
 * **StructuredDataTypeSet the host hands it** — it does *not* import `@hexly/plugin-content`. A body
 * Field's Markdown↔value conversion lives behind its data-type's projection (`core.datatype.rich-content`'s
 * converter, the grid's frontmatter default), so one hard-coded body is never traded for another.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  EntityDocument,
  Field,
  HEXLY_METADATA_PREFIX,
  resolvedStructuredDataTypeFields,
  StructuredDataType,
  StructuredDataTypeSet,
  VaultExportContext,
  VaultImportContext,
  vaultSlotOf,
} from '@hexly/domain';

/** The HTML comment naming a body Field's block, emitted only when an Entity writes more than one. */
function fieldMarker(key: string): string {
  return `<!-- hexly:field ${key} -->`;
}

/** Matches a marker on its own (trimmed) line, capturing the Field key it names. */
const FIELD_MARKER_LINE = /^<!-- hexly:field (\S+) -->$/;

/** A frontmatter block at the very start of the file: `---`, YAML, `---`, and the newline after it. */
const FRONTMATTER_BLOCK = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** One body Field paired with the data-type whose projection converts it. */
interface BodyField {
  readonly field: Field;
  readonly dataType: StructuredDataType;
}

/**
 * The body Fields among an already-resolved set of Fields of a Structured Data Type, in Field order: those whose Vault
 * Projection slot is `body` *and* whose data-type carries a body converter. An unresolved kind, or one
 * with no converter, contributes no body block.
 */
function bodyFieldsOf(resolved: BodyField[]): BodyField[] {
  return resolved.filter(
    ({ field, dataType }) => vaultSlotOf(field, dataType) === 'body' && !!dataType.vault?.toMarkdown,
  );
}

/** A present value: the EntityDocument holds the key with something other than `null`/`undefined`. */
function hasValue(doc: EntityDocument, key: string): boolean {
  const value = doc[key];
  return value !== undefined && value !== null;
}

/**
 * Serialize an Entity to one Markdown file (ADR-0051): its body Fields as the prose below the
 * frontmatter, its frontmatter Fields (and every other non-reserved EntityDocument key) as YAML.
 *
 * Body Fields are written in Field order. A marker comment precedes each block **only when more than
 * one body Field carries a value**, or when the single value is not the first body Field — so an
 * ordinary Note stays plain Markdown, byte-for-byte, while a two-prose Entity round-trips losslessly.
 * The reserved `hexly.*` namespace is consumed here; `frontmatter` carries the Entity-level additions
 * (Tags, the ordered type set) the host re-derives on the next import.
 */
export function entityToMarkdown(input: {
  doc: EntityDocument;
  fields: readonly Field[];
  dataTypes: StructuredDataTypeSet;
  frontmatter: Record<string, unknown>;
  context: VaultExportContext;
}): string {
  const { doc, fields, dataTypes, context } = input;
  const resolved = resolvedStructuredDataTypeFields(fields, dataTypes) as BodyField[];
  const bodyFields = bodyFieldsOf(resolved);
  const present = bodyFields.filter(({ field }) => hasValue(doc, field.id));
  // A marker is needed unless the only present body block is the first body Field — then the file is a
  // plain Note. Splitting an unmarked body always lands it in the first body Field, so a lone non-first
  // value must be marked too, or it would re-import into the wrong Field.
  const marked = present.length > 1 || (present.length === 1 && present[0].field.id !== bodyFields[0]?.field.id);

  const blocks = present.map(({ field, dataType }) => {
    // `bodyFieldsOf` has already narrowed to a body slot with a `toMarkdown` converter.
    const block = dataType.vault?.toMarkdown?.(doc[field.id], context) ?? '';
    return marked ? `${fieldMarker(field.id)}\n${block.trimEnd()}` : block;
  });
  const body = marked ? blocks.join('\n\n') : (blocks[0] ?? '');

  // A Field emitted as a body block, and an `omit` Field, both drop out of the frontmatter. Everything
  // else stays: a frontmatter-slot Field (a grid) rides the YAML, and so does a body-slot Field with no
  // converter — kept rather than lost. `resolved` is walked once; these are cheap filters over it.
  const excluded = new Set<string>([
    ...bodyFields.map(({ field }) => field.id),
    ...resolved.filter(({ field, dataType }) => vaultSlotOf(field, dataType) === 'omit').map(({ field }) => field.id),
  ]);
  const frontmatter = buildFrontmatter(doc, excluded, input.frontmatter);

  if (!frontmatter) return body;
  const yaml = stringifyYaml(frontmatter);
  return body ? `---\n${yaml}---\n\n${body}` : `---\n${yaml}---\n`;
}

/**
 * The YAML frontmatter map, or `undefined` when nothing remains (so the file exports with no `---`
 * block): every non-reserved EntityDocument key that is not a body/omit Field, plus the host's Entity-level
 * additions merged last. Reserved `hexly.*` keys are dropped here; the host re-adds the ones it stamps
 * (`hexly.type`) through `additions`, after the strip.
 */
function buildFrontmatter(
  doc: EntityDocument,
  excluded: ReadonlySet<string>,
  additions: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (excluded.has(key) || key.startsWith(HEXLY_METADATA_PREFIX)) continue;
    meta[key] = value;
  }
  Object.assign(meta, additions);
  return Object.keys(meta).length ? meta : undefined;
}

/** A Markdown file split into its parsed frontmatter and its raw body (ADR-0051, pass 1 of import). */
export interface SplitFile {
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
  readonly degraded: Record<string, number>;
}

/**
 * Split a Markdown file into its leading YAML frontmatter (parsed to a map) and the raw body below it.
 * Frontmatter must be a key/value map: a top-level list or scalar has no EntityDocument shape and
 * degrades to empty (tallied `frontmatter`), as does malformed YAML — never a throw. A file with no
 * frontmatter block returns the whole text as its body, untouched.
 */
export function splitFrontmatter(markdown: string): SplitFile {
  const degraded: Record<string, number> = {};
  const match = FRONTMATTER_BLOCK.exec(markdown);
  if (!match) return { frontmatter: {}, body: markdown, degraded };

  const body = markdown.slice(match[0].length);
  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(match[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>;
    } else if (parsed != null) {
      degraded['frontmatter'] = 1;
    }
  } catch {
    degraded['frontmatter'] = 1;
  }
  return { frontmatter, body, degraded };
}

/**
 * Convert a Markdown body into the body-Field slice of an EntityDocument (ADR-0051, pass 2 of import):
 * split on `<!-- hexly:field <key> -->` markers *before* conversion — ADR-0033 degrades Markdown
 * comments, so a marker that reached the converter would round-trip to nothing — and hand each segment
 * to its Field's projection. An **unmarked** body (a hand-written note, a foreign vault) lands in the
 * Entity's **first** body Field.
 *
 * A marker may name a Field this build's types do not resolve (a user-defined type exported from another
 * World). Its block is still preserved, at its own key, converted by the first body Field's projection —
 * every body slot is prose, so the converter is the right one, and the value survives as a plain
 * EntityDocument value the absent type would render (ADR-0051). It is dropped only when the Entity affords
 * no body Field at all.
 *
 * Returns only the keys it fills; the host overlays them on the frontmatter pass-through, body winning.
 */
export function bodyToFields(input: {
  body: string;
  fields: readonly Field[];
  dataTypes: StructuredDataTypeSet;
  context: VaultImportContext;
}): Record<string, unknown> {
  const { body, fields, dataTypes, context } = input;
  const resolved = resolvedStructuredDataTypeFields(fields, dataTypes) as BodyField[];
  const bodyFields = bodyFieldsOf(resolved).filter(({ dataType }) => !!dataType.vault?.fromMarkdown);
  if (bodyFields.length === 0) return {};

  const convert = (key: string, markdown: string, out: Record<string, unknown>) => {
    const bodyField = bodyFields.find(({ field }) => field.id === key) ?? bodyFields[0];
    // `bodyFields` is filtered to converters that exist; the guard just keeps the linter honest.
    const fromMarkdown = bodyField.dataType.vault?.fromMarkdown;
    if (fromMarkdown) out[key] = fromMarkdown(markdown, context);
  };

  const { preamble, segments } = splitBodyOnMarkers(body);
  const out: Record<string, unknown> = {};
  if (segments.length === 0) {
    // No markers: the whole body is the first body Field's — always populated (even when blank), so an
    // imported note always carries its prose Field.
    convert(bodyFields[0].field.id, body, out);
    return out;
  }
  // A stray preamble before the first marker belongs to the first body Field (a hand-edited export).
  if (preamble.trim()) convert(bodyFields[0].field.id, preamble, out);
  for (const { key, markdown } of segments) convert(key, markdown, out);
  return out;
}

/** Split a body into the text before its first marker and one `{ key, markdown }` per marked block. */
function splitBodyOnMarkers(body: string): {
  preamble: string;
  segments: { key: string; markdown: string }[];
} {
  const segments: { key: string; markdown: string }[] = [];
  const preambleLines: string[] = [];
  let current: { key: string; lines: string[] } | null = null;
  for (const line of body.split('\n')) {
    const marker = FIELD_MARKER_LINE.exec(line.trim());
    if (marker) {
      if (current) segments.push({ key: current.key, markdown: current.lines.join('\n').trim() });
      current = { key: marker[1], lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  if (current) segments.push({ key: current.key, markdown: current.lines.join('\n').trim() });
  return { preamble: preambleLines.join('\n'), segments };
}
