/**
 * The one derivation of an Entity's **document-derived state** (CONTEXT.md → Reindex): the searchable
 * text, the Link Descriptor vocabulary, the link edges, and the facet values an **Entity Document**
 * carries. The write path derives it on every save and Reindex rebuilds it from the stored document —
 * both through this single seam, so a new derived index is a new field on {@link DocumentDerivedState},
 * never a new call site (the friction ADR-0046/0048/0051/0055 spread across three functions).
 *
 * It names no extractor of its own: prose reaches the walk as the `core.datatype.rich-content` data-type, a grid
 * as `core.datatype.hex-grid`, so a new plugin needs no change here. `doc` is the EntityDocument map, `fields` its
 * resolved effective Field set ({@link resolveEffectiveFields}), and `dataTypes` the host-composed
 * **Structured Data Type** set (ADR-0050); a caller with no type context passes `[]` and the empty set
 * and gets an empty state.
 */

import type { AssetBytesRef } from './asset';
import { descriptorsSchema } from './entity';
import { EntityEdge } from './entity-edges';
import {
  EntityDocument,
  facetItems,
  Field,
  FieldFacetValue,
  isFacetableField,
  entityLinkFieldValues,
  readField,
  resolvedStructuredDataTypeFields,
} from './field';
import { ImportSource, readImportSource } from './importer';
import { joinSearchText } from './join-search-text';
import type { StructuredDataTypeSet } from './structured-data-type';

/** Everything one save derives from an Entity's document (and its effective Fields), in one pass. */
export interface DocumentDerivedState {
  /** The Entity's searchable text — the Content's prose and every Field of a Structured Data Type's (#205). */
  readonly searchText: string;
  /** The distinct, case-folded Link Descriptors the edges carry (a projection of `edges`, ADR-0046). */
  readonly descriptors: string[];
  /** Every edge the document expresses, deduped on `(targetKind, targetId, descriptor)` (ADR-0046). */
  readonly edges: EntityEdge[];
  /** The denormalised facetable Field values (ADR-0048, ADR-0055) — depends on the Fields *and* the document. */
  readonly fieldFacets: FieldFacetValue[];
  /**
   * The Entity's **Import Source** provenance, or `null` — the reserved `hexly.source` key, mirrored to the
   * derived `entityImportSource` index at the write choke point (ADR-0060). Unlike the edges and facets it
   * reads a plain document key, not a Field, so it needs neither the Field set nor the data-types.
   */
  readonly importSource: ImportSource | null;
  /**
   * The byte address of the bytes an Asset's asset-ref wraps, or `null` (ADR-0065) — mirrored to the
   * derived `(worldId, hash) → entity` index at the write choke point: the `hash` is the dedup key an
   * upload resolves against, the `ext` completes the on-disk address a read stats for presence (#325).
   * Harvested from the one **Structured Data Type** that owns bytes, like edges and facets.
   */
  readonly assetRef: AssetBytesRef | null;
  /**
   * The `entityId` the **Thumbnail** Field designates, or `null` (CONTEXT.md → Thumbnail, ADR-0066) —
   * mirrored to the nullable `thumbnail_entity_id` column at the write choke point so a list resolves the
   * designation through the asset dedup index (entityId → hash → served URL) as one indexed join, never a
   * read-time `json_extract`. Read from the entityLink value at {@link DeriveOptions.thumbnailFieldId};
   * an absent, ill-typed, or blank value is `null` (forward-only). No FK — a dangling link is a valid
   * document, and the read simply emits no URL.
   */
  readonly thumbnailEntityId: string | null;
}

/**
 * Host-supplied identifiers the derivation needs but cannot name itself, so the domain stays free of any
 * plugin's Field ids (the {@link StructuredDataTypeSet} precedent). The asset plugin owns
 * `core.field.thumbnail`, so the write choke point passes it in.
 */
export interface DeriveOptions {
  /**
   * The **Thumbnail** Field's id (`core.field.thumbnail`, ADR-0066) — the entityLink key whose target
   * `entityId` materialises into {@link DocumentDerivedState.thumbnailEntityId}. Omitted (the asset plugin
   * disabled, or a caller with no type context) yields no thumbnail designation.
   */
  readonly thumbnailFieldId?: string;
}

export function deriveDocumentState(
  doc: EntityDocument | undefined,
  fields: readonly Field[],
  dataTypes: StructuredDataTypeSet,
  options: DeriveOptions = {},
): DocumentDerivedState {
  // Edges dedup on (target, descriptor). `\0` cannot occur in an id or a descriptor, so the key is
  // unambiguous. The descriptor folds into the key but not the row: `"Spouse"` and `"spouse"` name one
  // relationship, and the first spelling authored is the one the edge — and References panel — carries.
  const edges = new Map<string, EntityEdge>();
  const addEdge = (edge: EntityEdge) => {
    const key = `${edge.targetKind}\0${edge.targetId}\0${edge.descriptor?.toLowerCase() ?? ''}`;
    const existing = edges.get(key);
    // First spelling of a descriptor wins the row (ADR-0046). Decor is the exception: an edge is decor
    // only if *every* producer that mints it is decor, so a semantic reason to link (a prose Entity Link
    // to the same target a Thumbnail also names) upgrades the merged edge out of decor (ADR-0069).
    if (!existing) edges.set(key, edge);
    else if (existing.decor && !edge.decor) edges.set(key, { ...existing, decor: false });
  };

  // Facets dedup on (key, value) so a value repeated within one Entity — a list with dupes, or a scalar
  // and a harvested dimension coinciding — counts once. Scalar Fields are added first, so a scalar wins
  // a shared (key, value) collision (ADR-0048); JSON.stringify keeps the two parts unambiguous.
  const facetSeen = new Set<string>();
  const fieldFacets: FieldFacetValue[] = [];
  const addFacet = (row: FieldFacetValue) => {
    const dedupKey = JSON.stringify([row.key, row.value]);
    if (facetSeen.has(dedupKey)) return;
    facetSeen.add(dedupKey);
    fieldFacets.push(row);
  };

  // A typed Entity-Link Field value is a descriptor-less edge to its target (#190); a facetable scalar
  // Field materialises its value. Both are lenses over the built-in Field data-types, no structure needed.
  // The **Thumbnail** Field is one such link (ADR-0066): the same shape-valid values feed its designation,
  // so its target is picked out here by key rather than parsed a second time.
  // A `decor` Field's edge is a **Decor Link** (ADR-0069): the producer declares decor-ness on the Field
  // (`core.field.thumbnail`, a user-defined "presentation only" link), so it rides the same harvest.
  const decorFieldIds = new Set(fields.filter((field) => field.decor).map((field) => field.id));
  let thumbnailEntityId: string | null = null;
  for (const { key, value } of entityLinkFieldValues(fields, doc)) {
    if (value.entityId)
      addEdge({ targetKind: 'entity', targetId: value.entityId, descriptor: null, decor: decorFieldIds.has(key) });
    if (key === options.thumbnailFieldId) thumbnailEntityId = value.entityId || null;
  }
  for (const field of fields) {
    if (!isFacetableField(field)) continue;
    const raw = readField(doc, field);
    if (raw === undefined || raw === null) continue;
    for (const item of facetItems(field.dataType, raw)) addFacet({ key: field.id, value: item.value, num: item.num });
  }

  // One pass over the Fields of a **Structured Data Type**: each value the host registered offers its
  // own edges, text, and facet dimensions (ADR-0050/0051/0055). The domain never learns what is inside —
  // and reads each value once, where three separate walks read it three times.
  const textParts: (string | undefined)[] = [];
  // At most one Field wraps stored bytes (an Asset's asset-ref); the first non-null address wins.
  let assetRef: AssetBytesRef | null = null;
  for (const { field, dataType } of resolvedStructuredDataTypeFields(fields, dataTypes)) {
    const value = readField(doc, field);
    for (const edge of dataType.harvestEdges?.(value) ?? []) addEdge(edge);
    textParts.push(dataType.extractText?.(value));
    for (const row of dataType.harvestFacets?.(value) ?? []) addFacet(row);
    assetRef ??= dataType.harvestAssetRef?.(value) ?? null;
  }

  const edgeList = [...edges.values()];
  return {
    searchText: joinSearchText(textParts),
    // The `::` vocabulary is a projection of the edge set, not a second walk: only a `content → entity`
    // edge carries a descriptor, so the non-null ones are exactly the descriptors the Content uses.
    descriptors: descriptorsSchema.parse(edgeList.flatMap((e) => e.descriptor ?? [])),
    edges: edgeList,
    fieldFacets,
    // Provenance is a plain reserved key, read forward-only: an absent or ill-shaped stamp is `null`.
    importSource: readImportSource(doc) ?? null,
    assetRef,
    thumbnailEntityId,
  };
}
