import { Inject, Injectable } from '@nestjs/common';
import { AvailableType, TypeFieldResolver, UserDefinedType } from '@hexly/domain';
import { eq } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { worldTypes } from '../db/schema';
import { TypeFieldRegistry } from './type-field-registry';

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
}
