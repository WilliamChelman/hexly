/**
 * The **Structured Field**'s data-type — the plugin-contributed member of the Field data-type set
 * (CONTEXT.md → Structured Field, ADR-0050). Unlike a built-in data-type (`string`, `number`,
 * `entityLink`…), which is a form control over a small value, a structured one is a *document*: a
 * value with its own schema, its own link-edge harvesting, and its own searchable text.
 *
 * A data-type is structured _iff_ its kind is a `namespace.id` id — no boolean flag declares it. The
 * *shape* of a kind is validated in the domain; its *membership* is resolved in the host, so a
 * well-formed but unregistered kind (`core.gird`) fails at resolution, against the set the host
 * composes.
 *
 * The set is threaded explicitly, never global: {@link validateFields} and {@link harvestEdges} take
 * a {@link StructuredDataTypeSet} as a parameter. The domain grows no mutable registry.
 */

import { z } from 'zod';
import type { EntityEdge } from './entity-edges';

/**
 * A structured data-type's id: a `namespace.id` key (`dnd.encounter`), mirroring the Entity Type
 * keyspace. No built-in kind (`string`, `entityLink`) carries a dot, so the two are disjoint at the
 * type level and "structured" narrows.
 */
export type StructuredDataTypeId = `${string}.${string}`;

const NAMESPACED_ID = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/;

/**
 * A Field's **Vault Projection** slot (CONTEXT.md → Vault Projection, ADR-0051): where its value takes
 * its place in an exported Markdown file — the `body` (prose below the frontmatter), the `frontmatter`
 * (YAML, nested if need be), or `omit` (written nowhere). A data-type supplies the default; a Field may
 * override it.
 */
export type VaultSlot = 'body' | 'frontmatter' | 'omit';

export const vaultSlotSchema = z.enum(['body', 'frontmatter', 'omit']);

/**
 * What a `body` projection's {@link VaultProjection.toMarkdown} may reach for while serializing, without
 * the converter itself knowing the World: the CURRENT name of a linked Entity (so a post-import rename
 * still round-trips its `[[wikilink]]`) and the exported path an Asset's capability URL was written to.
 */
export interface VaultExportContext {
  /** The linked Entity's current name, or `undefined` when it is unknown (deleted / cross-World). */
  entityName(entityId: string): string | undefined;
  /** The exported vault path an Asset's capability URL was written under, or `undefined` if not exported. */
  assetPath(url: string): string | undefined;
}

/**
 * What a `body` projection's {@link VaultProjection.fromMarkdown} may reach for while parsing, so the
 * converter can live behind the data-type instead of inside `libs/obsidian` (ADR-0051): link resolution
 * (a wikilink label → an `entityId`, `null` when it names no imported note — a dangling link), asset
 * storage (a vault-relative src → its served capability URL, `null` when it names no vault Asset), and a
 * degradation tally for a construct with no native node. The host supplies these; the converter never
 * sees the DB or the asset store.
 */
export interface VaultImportContext {
  resolveLink(label: string): string | null;
  storeAsset(src: string): string | null;
  degrade(construct: string, count?: number): void;
}

/**
 * A data-type's **Vault Projection** (CONTEXT.md, ADR-0051): the slot its value lands in, and — for a
 * `body` slot — the converters between the value and its Markdown block. A `frontmatter` or `omit` slot
 * needs no converters: the vault layer serializes a frontmatter value as YAML itself, and drops an
 * omitted one. `fromMarkdown` takes a {@link VaultImportContext} so link/asset resolution passes through
 * it rather than back into the host.
 */
export interface VaultProjection {
  readonly slot: VaultSlot;
  toMarkdown?(value: unknown, ctx: VaultExportContext): string;
  fromMarkdown?(markdown: string, ctx: VaultImportContext): unknown;
}

export const structuredDataTypeIdSchema = z.custom<StructuredDataTypeId>(
  // Exact, never trimmed: the id is a *key* — the one a Field's `kind` is looked up under — so
  // tolerating ` core.grid ` here would register a data-type that could never be resolved.
  (value) => typeof value === 'string' && NAMESPACED_ID.test(value),
  { message: 'A structured data-type must be a `namespace.id` key' },
);

/**
 * One registered structured data-type, as the domain consumes it — type-erased over its value.
 * Plugins go through {@link defineStructuredDataType}, which keeps the value type.
 */
export interface StructuredDataType {
  readonly id: StructuredDataTypeId;
  /** The value's shape — what the forward-only gate holds a value to. */
  readonly valueSchema: z.ZodType;
  /** A fresh empty value — a map plugin's untouched plane, an empty timeline. */
  empty(): unknown;
  /**
   * The Entity Links this value expresses (a map's placements, a timeline's entries, a document's
   * inline links), harvested into the edge index. Absent when the data-type carries no links.
   */
  harvestEdges?(value: unknown): readonly EntityEdge[];
  /**
   * The searchable text this value carries (a grid's Hex and Region names, a document's prose),
   * concatenated into the Entity's full-text index. Absent when the data-type carries no text.
   */
  extractText?(value: unknown): string;
  /**
   * How this value takes its place in an exported Markdown file (CONTEXT.md → Vault Projection). The
   * data-type supplies the default slot; a Field may override it. `core.rich-content` projects to the
   * `body`, `core.hex-grid` to `frontmatter`. Absent when the data-type has no opinion (the vault layer
   * then treats the value as ordinary frontmatter).
   */
  readonly vault?: VaultProjection;
}

/**
 * Declare a structured data-type. A malformed id (`strig` — no namespace) throws at module load.
 *
 * The declared capabilities see a *parsed* value; a value that does not inhabit `valueSchema` yields
 * no edges and no text rather than throwing — the forward-only tolerance the write path needs for a
 * document at rest this build cannot parse.
 */
export function defineStructuredDataType<T>(definition: {
  readonly id: string;
  readonly valueSchema: z.ZodType<T>;
  readonly empty: () => T;
  readonly harvestEdges?: (value: T) => readonly EntityEdge[];
  readonly extractText?: (value: T) => string;
  /**
   * The data-type's default {@link VaultProjection}. Its converters see the value *unparsed* (cast to
   * `T`), unlike {@link harvestEdges}/{@link extractText}: an export must tolerate a value this build
   * cannot re-parse rather than silently dropping it, so the converter narrows defensively itself.
   */
  readonly vault?: {
    readonly slot: VaultSlot;
    readonly toMarkdown?: (value: T, ctx: VaultExportContext) => string;
    readonly fromMarkdown?: (markdown: string, ctx: VaultImportContext) => T;
  };
}): StructuredDataType {
  const id = structuredDataTypeIdSchema.parse(definition.id);
  const { valueSchema, empty, harvestEdges, extractText, vault } = definition;
  return Object.freeze<StructuredDataType>({
    id,
    valueSchema: valueSchema as z.ZodType,
    empty,
    ...(harvestEdges && {
      harvestEdges: (value: unknown) => {
        const parsed = valueSchema.safeParse(value);
        return parsed.success ? harvestEdges(parsed.data) : [];
      },
    }),
    ...(extractText && {
      extractText: (value: unknown) => {
        const parsed = valueSchema.safeParse(value);
        return parsed.success ? extractText(parsed.data) : '';
      },
    }),
    ...(vault && {
      vault: Object.freeze<VaultProjection>({
        slot: vault.slot,
        ...(vault.toMarkdown && { toMarkdown: (value: unknown, ctx) => vault.toMarkdown!(value as T, ctx) }),
        ...(vault.fromMarkdown && { fromMarkdown: (markdown: string, ctx) => vault.fromMarkdown!(markdown, ctx) }),
      }),
    }),
  });
}

/**
 * The resolved structured data-type set a host composes and threads into the domain — the API from
 * its bundled plugins, the web from `providePlugin()`, a test from whatever it declares itself.
 */
export type StructuredDataTypeSet = ReadonlyMap<string, StructuredDataType>;

/** The empty set: what a caller with no structured data-types in play passes (and every one does today). */
export const NO_STRUCTURED_DATA_TYPES: StructuredDataTypeSet = new Map();

/** Compose a set from the declarations a host bundles. A duplicate id is a build error, not a silent win. */
export function structuredDataTypeSet(dataTypes: readonly StructuredDataType[]): StructuredDataTypeSet {
  const set = new Map<string, StructuredDataType>();
  for (const dataType of dataTypes) {
    if (set.has(dataType.id)) throw new Error(`Duplicate structured data-type: ${dataType.id}`);
    set.set(dataType.id, dataType);
  }
  return set;
}
