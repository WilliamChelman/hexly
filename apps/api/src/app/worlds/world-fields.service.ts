import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  ApiError,
  CreateWorldFieldRequest,
  EntityErrorCode,
  Field,
  UpdateWorldFieldRequest,
  unresolvedDataTypeErrors,
  worldFieldIdFromSegment,
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
 * Field change bumps the World's `seq` and nudges its followers. A deleted Field degrades forward-only —
 * it stops resolving, leaving its document values as plain values (handled by the resolver, not a
 * cascade here). The id/key is frozen at create (ADR-0056), so there is no re-key path to degrade.
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

  /**
   * Author a new World-defined Field (Owner-only). The `world.<segment>` id — which *is* the document key
   * it lenses (ADR-0056) — is slugged from the editable segment and frozen. `conflict` if the derived
   * slug collides. The stored `definition` is the id-less body; the row's `fieldId` carries the id.
   */
  create(userId: string, worldId: string, req: CreateWorldFieldRequest): TypeResult<Field> {
    const gate = this.gateOwner(userId, worldId);
    if (gate) return gate;
    const { segment, ...body } = req;
    const id = worldFieldIdFromSegment(segment);
    if (this.fields.list(worldId).some((field) => field.id === id)) return { status: 'conflict' };
    const field: Field = { id, ...body };
    this.assertDataTypeResolves(field);
    this.writes.createField(worldId, id, body);
    return { status: 'ok', value: field };
  }

  /**
   * Re-body a World-defined Field (Owner-only). `not-found` if the World is unreachable or the id is not
   * defined. The id is immutable (ADR-0056): a path param, never the body — so renaming is label-only.
   */
  update(userId: string, worldId: string, fieldId: string, patch: UpdateWorldFieldRequest): TypeResult<Field> {
    const gate = this.gateOwner(userId, worldId);
    if (gate) return gate;
    const field: Field = { id: fieldId, ...patch };
    this.assertDataTypeResolves(field);
    if (!this.writes.updateField(worldId, fieldId, patch)) return { status: 'not-found' };
    return { status: 'ok', value: field };
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
  private assertDataTypeResolves(field: Field): void {
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
