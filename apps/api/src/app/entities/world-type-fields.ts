import { Inject, Injectable } from '@nestjs/common';
import { AvailableType, FieldSchema, TypeFieldResolver, UserDefinedType } from '@hexly/domain';
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
      .select({ id: worldTypes.typeId, label: worldTypes.label, fields: worldTypes.fields, views: worldTypes.views })
      .from(worldTypes)
      .where(eq(worldTypes.worldId, worldId))
      .orderBy(worldTypes.typeId)
      .all()
      .map((row) => ({
        id: row.id,
        label: row.label,
        fields: row.fields ?? [],
        // `fieldRefs` (ADR-0054) has no stored column yet — the expand step keeps the inline `fields`
        // path; persisting referenced Field ids is a later migrate step.
        fieldRefs: [],
        // A stored `null` is "the author named no order", which the web defaults — so it stays absent
        // rather than becoming an empty list, which would mean "this type affords no View at all".
        ...(row.views ? { views: row.views } : {}),
      }));
  }

  /**
   * A {@link TypeFieldResolver} scoped to one World: user-defined Fields first, else the plugin
   * registry. The World's types are loaded once and closed over — resolving is a map lookup, not a
   * query per type.
   */
  resolverFor(worldId: string): TypeFieldResolver {
    const userFields = new Map(this.list(worldId).map((type) => [type.id, type.fields]));
    return (typeId) => userFields.get(typeId) ?? this.plugins.resolver(typeId);
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
   * plugin's Field, ADR-0052) is skipped, its value left untouched (forward-only).
   */
  effectiveFields(worldId: string | undefined, types: readonly string[], fieldIds: readonly string[]): FieldSchema[] {
    const byKey = new Map<string, FieldSchema>();
    const consider = (field: FieldSchema | undefined) => {
      if (field && !byKey.has(field.key)) byKey.set(field.key, field);
    };
    // World-scoped when a `worldId` is in play so its user-defined types/Fields resolve too; else the
    // plugin registry alone (a gate that runs before a row's World is known).
    const inlineResolver = worldId ? this.resolverFor(worldId) : this.plugins.resolver;
    // The composed Field resolver: World-defined Fields over Plugin fields (ADR-0054), so a deleted
    // World Field simply stops resolving and its values degrade to plain — forward-only.
    const fieldResolver = worldId ? this.worldFields.resolverFor(worldId) : this.plugins.fieldResolver;
    // Attached Fields first (most specific), then each type's defaults primary-first — first-wins per key.
    for (const id of fieldIds ?? []) consider(fieldResolver(id));
    for (const type of types) {
      // Plugin type: defaults via `fieldRefs` → the id resolver (ADR-0054). Inline fallback covers a
      // User-defined type's Fields (no id until the World Fields step) and anything the resolver can't reach.
      for (const id of this.plugins.typeFieldRefs(type) ?? []) consider(fieldResolver(id));
      for (const field of inlineResolver(type) ?? []) consider(field);
    }
    return [...byKey.values()];
  }
}
