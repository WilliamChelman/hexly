import { Inject, Injectable } from '@nestjs/common';
import { Field, FieldResolver } from '@hexly/domain';
import { eq } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { worldFields } from '../db/schema';
import { TypeFieldRegistry } from './type-field-registry';

/**
 * The Container-scoped view of the **Field** set (CONTEXT.md → Field, ADR-0054, ADR-0078): a
 * Container's user-defined Fields (`world_fields`) composed over the instance-wide Plugin fields. Lives
 * in the Entity module (not Worlds) because it backs the write-path effective-set resolver
 * {@link WorldTypeFields} threads, and the Worlds CRUD service reads it for the conflict check.
 */
@Injectable()
export class WorldFields {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly plugins: TypeFieldRegistry,
  ) {}

  /**
   * A Container's stored user-defined Fields, in a stable id order (the CRUD read + the resolver source).
   * The stored `definition` is the id-less Field body; the row's `fieldId` re-heads it into a {@link Field}.
   */
  list(containerId: string): Field[] {
    return this.db
      .select({ id: worldFields.fieldId, definition: worldFields.definition })
      .from(worldFields)
      .where(eq(worldFields.containerId, containerId))
      .orderBy(worldFields.fieldId)
      .all()
      .map((row) => ({ id: row.id, ...row.definition }));
  }

  /**
   * A {@link FieldResolver} scoped to one Container: its user-defined Fields first, else the Plugin
   * fields (ADR-0054). The Container's Fields are loaded once and closed over — resolving is a map
   * lookup, not a query per id. An id neither layer carries resolves to `undefined`, which the
   * effective-set resolver drops (forward-only): a deleted World Field degrades its document values to
   * plain values.
   */
  resolverFor(containerId: string): FieldResolver {
    const byId = new Map(this.list(containerId).map((field) => [field.id, field]));
    return (id) => byId.get(id) ?? this.plugins.fieldResolver(id);
  }
}
