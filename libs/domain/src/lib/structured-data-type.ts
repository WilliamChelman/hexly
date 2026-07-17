/**
 * The **Structured Data Type** — the plugin-contributed member of the Field data-type set
 * (CONTEXT.md → Structured Data Type, ADR-0050/0054). Unlike a built-in data-type (`string`, `number`,
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
import type { FieldDataType } from './field';

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
 * One **Facet** dimension a structured data-type harvests (ADR-0055): the facet `key` it surfaces under
 * (shared with scalar Fields' document keys), its i18n `labelKey`, and the `dataType` the rail picks a
 * control from. The static mirror of {@link StructuredDataType.valueSchema}.
 */
export interface FacetDimension {
  readonly key: string;
  readonly labelKey: string;
  readonly dataType: FieldDataType;
}

/**
 * One facet row a structured data-type emits from a value (ADR-0055): a `key` drawn from the declared
 * {@link FacetDimension}s, its string `value`, and `num` — the numeric form of a numeric dimension, else
 * `null`. A separate declaration from the scalar `FieldFacetValue` it mirrors, so this module needn't
 * import back from `field.ts`.
 */
export interface HarvestedFacet {
  readonly key: string;
  readonly value: string;
  readonly num: number | null;
}

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
   * The **Facet** dimensions this value harvests (ADR-0055) — the static declaration {@link harvestFacets}
   * draws its emitted keys from. Absent when the data-type harvests no facets.
   */
  readonly facetDimensions?: readonly FacetDimension[];
  /**
   * The Facet values this value carries (a stat block's size and challenge-rating), harvested into the
   * facet index. Emitted keys are drawn from {@link facetDimensions}. Absent when it harvests none.
   */
  harvestFacets?(value: unknown): readonly HarvestedFacet[];
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
 * The declared harvesters see a *parsed* value; a value that does not inhabit `valueSchema` yields
 * nothing rather than throwing — the forward-only tolerance the write path needs for a document at rest
 * this build cannot parse. `harvestFacets` rows are additionally filtered to the declared
 * `facetDimensions` keys; `facetDimensions` itself passes through unwrapped.
 */
export function defineStructuredDataType<T>(definition: {
  readonly id: string;
  readonly valueSchema: z.ZodType<T>;
  readonly empty: () => T;
  readonly harvestEdges?: (value: T) => readonly EntityEdge[];
  readonly extractText?: (value: T) => string;
  readonly facetDimensions?: readonly FacetDimension[];
  readonly harvestFacets?: (value: T) => readonly HarvestedFacet[];
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
  const { valueSchema, empty, harvestEdges, extractText, facetDimensions, harvestFacets, vault } = definition;
  const declaredFacetKeys = new Set((facetDimensions ?? []).map((dimension) => dimension.key));
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
    ...(facetDimensions && { facetDimensions }),
    ...(harvestFacets && {
      harvestFacets: (value: unknown) => {
        const parsed = valueSchema.safeParse(value);
        // Forward-only, and keys must be declared: a row under an undeclared key never reaches the index.
        return parsed.success ? harvestFacets(parsed.data).filter((row) => declaredFacetKeys.has(row.key)) : [];
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
