import { Inject, Injectable } from '@nestjs/common';
import {
  AvailableType,
  EntityDocument,
  Field,
  FieldDataType,
  isFacetableField,
  resolveEffectiveFields,
  TypeFieldRefsResolver,
  UserDefinedType,
} from '@hexly/domain';
import { eq } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { worldTypes } from '../db/schema';
import { TypeFieldRegistry } from './type-field-registry';
import { WorldFields } from './world-fields';

/**
 * The Container-scoped view of the Entity Type set (ADR-0048, ADR-0078): a Container's user-defined
 * types layered over the instance-wide plugin types. Lives in the Entity module (not Worlds) because
 * Worlds already depends on Entities, and the write-path gate resolves through it. A World-scoped
 * caller binds its World id here unchanged — a World's Container id *is* the World's id.
 */
@Injectable()
export class WorldTypeFields {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly plugins: TypeFieldRegistry,
    private readonly worldFields: WorldFields,
  ) {}

  /** A Container's stored user-defined types, in a stable id order (the CRUD read + the merge source). */
  list(containerId: string): UserDefinedType[] {
    return this.db
      .select({
        id: worldTypes.typeId,
        label: worldTypes.label,
        fieldRefs: worldTypes.fieldRefs,
        views: worldTypes.views,
      })
      .from(worldTypes)
      .where(eq(worldTypes.containerId, containerId))
      .orderBy(worldTypes.typeId)
      .all()
      .map((row) => ({
        id: row.id,
        label: row.label,
        // Default Fields referenced by id (ADR-0054) — the sole Field declaration a type carries.
        fieldRefs: row.fieldRefs ?? [],
        // A stored `null` is "the author named no order", which the web defaults — so it stays absent
        // rather than becoming an empty list, which would mean "this type affords no View at all".
        ...(row.views ? { views: row.views } : {}),
      }));
  }

  /**
   * A {@link TypeFieldRefsResolver} scoped to one Container: a user-defined type's default Field ids
   * (`fieldRefs`) first, else the plugin registry's. The Container's types are loaded once and closed
   * over — resolving is a map lookup, not a query per type.
   */
  private typeFieldRefsFor(containerId: string | undefined): TypeFieldRefsResolver {
    if (!containerId) return this.plugins.typeFieldRefs;
    const userRefs = new Map(this.list(containerId).map((type) => [type.id, type.fieldRefs]));
    return (typeId) => userRefs.get(typeId) ?? this.plugins.typeFieldRefs(typeId);
  }

  /** The Entity Types available in a Container: the instance-wide plugin types plus its own. */
  availableTypes(containerId: string): AvailableType[] {
    return [
      ...this.plugins.plugins(),
      ...this.list(containerId).map((type): AvailableType => ({ ...type, source: 'user' })),
    ];
  }

  /**
   * An Entity's **effective Field set** (CONTEXT.md → Entity, ADR-0054/ADR-0056/ADR-0057): its attached
   * extras — derived from the `doc` (a registered key no type defaults) — unioned with its types' defaults,
   * deduped by `id`. What every downstream pure function runs over, so an attached Field is validated,
   * faceted, and edge-harvested like a type default. A key resolving to nothing (a disabled/absent plugin's
   * Field, a deleted World Field, a foreign bare key, ADR-0052/0054) is skipped, its value left untouched
   * (forward-only) — one resolution path, id → Field, with no inline schema and no stored attachment list.
   */
  effectiveFields(containerId: string | undefined, types: readonly string[], doc: EntityDocument | undefined): Field[] {
    // Container-scoped when a `containerId` is in play so its user-defined Fields resolve too; else the
    // Plugin fields alone (a gate that runs before a row's Container is known).
    const fieldResolver = containerId ? this.worldFields.resolverFor(containerId) : this.plugins.fieldResolver;
    return resolveEffectiveFields({
      types,
      doc,
      fieldResolver,
      typeFieldRefs: this.typeFieldRefsFor(containerId),
    });
  }

  /**
   * The label/control source a presence-based Field facet resolves a present `key` against (#231,
   * #235, ADR-0054, ADR-0055), indexed by EntityDocument `key`, with no type in play. Two sources share
   * the flat key space: every facetable **scalar Field** (a World-defined Field wins a Plugin Field,
   * mirroring the effective-set resolver's precedence), then each enabled **Structured Data Type**'s
   * harvested facet dimensions. A scalar Field wins a key claimed by both — it is the direct lens
   * over an actual document key (ADR-0055) — so dimensions only fill keys no scalar Field claims. The
   * insertion order is the rail's stable declaration order: scalars, then dimensions.
   *
   * Takes the read's whole **Container** scope, since a browse may span several (the Compendium
   * browse unions every installed pack): each Container's own Fields are folded in, later ones winning
   * a shared key, exactly as one Container's win over a Plugin's.
   */
  facetSourcesByKey(containerIds: readonly string[] | undefined): Map<string, FacetSource> {
    const byKey = new Map<string, FacetSource>();
    // Scalar Fields first — Plugin then user-defined, so a Container-defined Field wins the key (ADR-0054).
    for (const field of this.plugins.fields()) if (isFacetableField(field)) byKey.set(field.id, scalarSource(field));
    for (const containerId of containerIds ?? [])
      for (const field of this.worldFields.list(containerId))
        if (isFacetableField(field)) byKey.set(field.id, scalarSource(field));
    // Then harvested dimensions — the scalar walk ran first, so a shared key keeps its scalar (ADR-0055).
    for (const dataType of this.plugins.structuredDataTypes.values())
      for (const dimension of dataType.facetDimensions ?? [])
        if (!byKey.has(dimension.key))
          byKey.set(dimension.key, {
            key: dimension.key,
            label: dimension.labelKey,
            labelKey: dimension.labelKey,
            // Carry the per-value i18n prefix so the rail can translate the dimension's values (ADR-0055).
            ...(dimension.valuesKeyPrefix ? { valuesKeyPrefix: dimension.valuesKeyPrefix } : {}),
            dataType: dimension.dataType,
          });
    return byKey;
  }
}

/**
 * The label/control metadata a presence-based Field facet is built from (#235, ADR-0055) — a scalar
 * **Field** or a harvested **FacetDimension**, unified to one shape. `labelKey` is set only for a
 * dimension (its i18n key, which the rail translates); a scalar's `label` is its authored string.
 */
export interface FacetSource {
  readonly key: string;
  readonly label: string;
  readonly labelKey?: string;
  readonly valuesKeyPrefix?: string;
  readonly dataType: FieldDataType;
}

/** A scalar Field as a {@link FacetSource}: its authored `label`, no `labelKey` (nothing to translate). */
function scalarSource(field: Field): FacetSource {
  return { key: field.id, label: field.label, dataType: field.dataType };
}
