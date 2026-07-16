import { Inject, Injectable } from '@nestjs/common';
import {
  AvailableType,
  BuiltInDataType,
  FieldSchema,
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
 * The World-scoped view of the Entity Type set (ADR-0048): a World's user-defined types layered over
 * the instance-wide plugin types. Lives in the Entity module (not Worlds) because Worlds already
 * depends on Entities, and the write-path gate resolves through it.
 */
@Injectable()
export class WorldTypeFields {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly plugins: TypeFieldRegistry,
    private readonly worldFields: WorldFields,
  ) {}

  /** A World's stored user-defined types, in a stable id order (the CRUD read + the merge source). */
  list(worldId: string): UserDefinedType[] {
    return this.db
      .select({
        id: worldTypes.typeId,
        label: worldTypes.label,
        fieldRefs: worldTypes.fieldRefs,
        views: worldTypes.views,
      })
      .from(worldTypes)
      .where(eq(worldTypes.worldId, worldId))
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
   * A {@link TypeFieldRefsResolver} scoped to one World: a user-defined type's default Field ids
   * (`fieldRefs`) first, else the plugin registry's. The World's types are loaded once and closed
   * over — resolving is a map lookup, not a query per type.
   */
  private typeFieldRefsFor(worldId: string | undefined): TypeFieldRefsResolver {
    if (!worldId) return this.plugins.typeFieldRefs;
    const userRefs = new Map(this.list(worldId).map((type) => [type.id, type.fieldRefs]));
    return (typeId) => userRefs.get(typeId) ?? this.plugins.typeFieldRefs(typeId);
  }

  /** The Entity Types available in a World: the instance-wide plugin types plus this World's own. */
  availableTypes(worldId: string): AvailableType[] {
    return [
      ...this.plugins.plugins(),
      ...this.list(worldId).map((type): AvailableType => ({ ...type, source: 'user' })),
    ];
  }

  /**
   * An Entity's **effective Field set** (CONTEXT.md → Entity, ADR-0054): its attached Fields (`fieldIds`)
   * unioned with its types' defaults, deduped by document `key` with precedence instance > primary type
   * > later types. What every downstream pure function runs over, so an attached Field is validated,
   * faceted, and edge-harvested like a type default. An id resolving to nothing (a disabled/absent
   * plugin's Field, or a deleted World Field, ADR-0052/0054) is skipped, its value left untouched
   * (forward-only) — one resolution path, id → Field, with no inline schema.
   */
  effectiveFields(worldId: string | undefined, types: readonly string[], fieldIds: readonly string[]): FieldSchema[] {
    // World-scoped when a `worldId` is in play so its user-defined Fields resolve too; else the Plugin
    // fields alone (a gate that runs before a row's World is known).
    const fieldResolver = worldId ? this.worldFields.resolverFor(worldId) : this.plugins.fieldResolver;
    return resolveEffectiveFields({
      types,
      fieldIds: fieldIds ?? [],
      fieldResolver,
      typeFieldRefs: this.typeFieldRefsFor(worldId),
    });
  }

  /**
   * Every facetable Field resolvable in a World, indexed by the EntityDocument `key` it lenses — the
   * label/data-type source a presence-based Field facet resolves a present key against (#231, ADR-0054),
   * with no type in play. A World-defined Field wins a key over a Plugin Field, mirroring the effective-set
   * resolver's precedence (ADR-0054). A Field of a **Structured Data Type** is excluded — never facetable.
   */
  facetableFieldsByKey(worldId: string | undefined): Map<string, FieldSchema & { dataType: BuiltInDataType }> {
    const byKey = new Map<string, FieldSchema & { dataType: BuiltInDataType }>();
    // Plugin fields first, then World fields overwrite — World-defined wins the key (ADR-0054).
    for (const field of this.plugins.fields()) if (isFacetableField(field)) byKey.set(field.key, field);
    if (worldId)
      for (const field of this.worldFields.list(worldId)) if (isFacetableField(field)) byKey.set(field.key, field);
    return byKey;
  }
}
