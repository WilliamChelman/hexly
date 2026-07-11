import { Inject, Injectable } from '@nestjs/common';
import { AvailableType, TypeFieldResolver, UserDefinedType } from '@hexly/domain';
import { eq } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { worldTypes } from '../db/schema';
import { TypeFieldRegistry } from './type-field-registry';

/**
 * The **World-scoped** view of the Entity Type set (ADR-0048): a World's user-defined types (stored
 * in `world_types`) layered over the instance-wide plugin types ({@link TypeFieldRegistry}). It is
 * the read half of user-defined types — the write half lives in {@link WorldTypesService}, and the
 * mutations route through the World write choke point.
 *
 * It lives in the Entity module, not the World module, so the write-path gate ({@link EntitiesService})
 * and the derived-index build ({@link EntityWrites}) can resolve a `types[]` set to Fields that
 * include a World's user-defined types **without** pulling the whole World feature module in (which
 * already depends back on Entities — a cycle). The World feature imports the Entity module and reads
 * the available-types set from here.
 *
 * A World's user-defined types are visible only through *that* World's `worldId`, so one World's
 * `world.deity` never leaks into another's — World scoping falls straight out of the keyed read.
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
      .select({ id: worldTypes.typeId, label: worldTypes.label, fields: worldTypes.fields })
      .from(worldTypes)
      .where(eq(worldTypes.worldId, worldId))
      .orderBy(worldTypes.typeId)
      .all()
      .map((row) => ({ id: row.id, label: row.label, fields: row.fields ?? [] }));
  }

  /**
   * A {@link TypeFieldResolver} scoped to one World: a type's Fields come from the World's
   * user-defined types first, else the instance-wide plugin registry. The World's types are loaded
   * once here and closed over, so unioning a `types[]` set is a map lookup, not a query per type.
   * A user-defined type shadows a plugin of the same id — impossible today (user ids are `world.`,
   * plugin ids are not), but the precedence is defined rather than accidental.
   */
  resolverFor(worldId: string): TypeFieldResolver {
    const userFields = new Map(this.list(worldId).map((type) => [type.id, type.fields]));
    return (typeId) => userFields.get(typeId) ?? this.plugins.resolver(typeId);
  }

  /**
   * The Entity Types **available in a World** (ADR-0048): the instance-wide plugin types plus this
   * World's user-defined types — the set the create dialog, facet labels, and view resolution read.
   * Plugin first, then the World's own, so the list reads instance-vocabulary-then-local.
   */
  availableTypes(worldId: string): AvailableType[] {
    return [
      ...this.plugins.plugins(),
      ...this.list(worldId).map((type): AvailableType => ({ ...type, source: 'user' })),
    ];
  }
}
