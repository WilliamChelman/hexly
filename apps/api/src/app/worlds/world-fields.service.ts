import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  ApiError,
  CreateWorldFieldRequest,
  EntityErrorCode,
  Field,
  FieldSchema,
  UpdateWorldFieldRequest,
  unresolvedDataTypeErrors,
} from '@hexly/domain';
import { worldAccess } from '../acl/world-access';
import { DB, Db } from '../db/db';
import { TypeFieldRegistry } from '../entities/type-field-registry';
import { WorldFields } from '../entities/world-fields';
import { WorldWrites } from './world-writes';
import { TypeResult } from './world-types.service';

/**
 * A World's user-defined **Field** CRUD (CONTEXT.md → Field, ADR-0054), the Field peer of
 * {@link WorldTypesService}: list (reachable-gated, any member — the resolver and attach picker read
 * it), and create/patch/delete (World-Owner-gated). Mutations route through {@link WorldWrites}, so a
 * Field change bumps the World's `seq` and nudges its followers. Delete/re-key degrade forward-only —
 * a Field that stops resolving leaves its document values as plain values (handled by the resolver, not
 * a cascade here).
 */
@Injectable()
export class WorldFieldsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly fields: WorldFields,
    private readonly writes: WorldWrites,
    private readonly plugins: TypeFieldRegistry,
  ) {}

  /** A World's user-defined Fields. Reachable-gated (any member); unreachable → `not-found`. */
  list(userId: string, worldId: string): Field[] | 'not-found' {
    if (!worldAccess(this.db, userId).decideMeta(worldId)?.reachable) return 'not-found';
    return this.fields.list(worldId);
  }

  /** Author a new World-defined Field (Owner-only). `conflict` if the id is already defined in the World. */
  create(userId: string, worldId: string, req: CreateWorldFieldRequest): TypeResult<Field> {
    const gate = this.gateOwner(userId, worldId);
    if (gate) return gate;
    if (this.fields.list(worldId).some((field) => field.id === req.id)) return { status: 'conflict' };
    const { id, ...definition } = req;
    this.assertDataTypeResolves(definition);
    this.writes.createField(worldId, id, definition);
    return { status: 'ok', value: req };
  }

  /**
   * Re-body a World-defined Field (Owner-only). `not-found` if the World is unreachable or the id is not
   * defined. The id is immutable — followers key off it, so it is a path param, not in the body.
   */
  update(userId: string, worldId: string, fieldId: string, patch: UpdateWorldFieldRequest): TypeResult<Field> {
    const gate = this.gateOwner(userId, worldId);
    if (gate) return gate;
    this.assertDataTypeResolves(patch);
    if (!this.writes.updateField(worldId, fieldId, patch)) return { status: 'not-found' };
    return { status: 'ok', value: { id: fieldId, ...patch } };
  }

  /**
   * Delete a World-defined Field (Owner-only). Entities referencing it keep their EntityDocument as
   * plain values (a Field is a lens) — the drop de-types the key without touching the body (ADR-0054).
   */
  delete(userId: string, worldId: string, fieldId: string): TypeResult<null> {
    const gate = this.gateOwner(userId, worldId);
    if (gate) return gate;
    return this.writes.deleteField(worldId, fieldId) ? { status: 'ok', value: null } : { status: 'not-found' };
  }

  /**
   * A Field may name a plugin's **Structured Data Type** (`core.hex-grid`), so authoring one is where an
   * unregistered kind is rejected (ADR-0050/0054) — against the composed set, since no schema could
   * enumerate a kind a plugin registers at module load.
   */
  private assertDataTypeResolves(field: FieldSchema): void {
    const errors = unresolvedDataTypeErrors([field], this.plugins.structuredDataTypes);
    if (errors.length > 0)
      throw new BadRequestException({
        code: EntityErrorCode.InvalidFields,
        data: { fields: errors },
      } satisfies ApiError);
  }

  /** Gate a mutation: undefined when Owner, else unreachable → `not-found`, non-Owner → `forbidden`. */
  private gateOwner(
    userId: string,
    worldId: string,
  ): Extract<TypeResult<never>, { status: 'not-found' | 'forbidden' }> | undefined {
    const meta = worldAccess(this.db, userId).decideMeta(worldId);
    if (!meta?.reachable) return { status: 'not-found' };
    if (!meta.isOwner) return { status: 'forbidden' };
    return undefined;
  }
}
