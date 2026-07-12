import { BadRequestException, Injectable, Inject } from '@nestjs/common';
import {
  ApiError,
  AvailableType,
  CreateUserDefinedTypeRequest,
  EntityErrorCode,
  FieldSchema,
  isFieldViewPlacement,
  UpdateUserDefinedTypeRequest,
  unresolvedDataTypeErrors,
  UserDefinedType,
  ViewPlacement,
} from '@hexly/domain';
import { DB, Db } from '../db/db';
import { worldAccess } from '../acl/world-access';
import { TypeFieldRegistry } from '../entities/type-field-registry';
import { WorldTypeFields } from '../entities/world-type-fields';
import { WorldWrites } from './world-writes';

/**
 * A World's user-defined type CRUD, plus the per-World available-types read (ADR-0048, #191). The
 * read is reachable-gated (any member); the mutations are World-Owner-gated and route through
 * {@link WorldWrites}, so a type change bumps the World's `seq` and nudges its followers.
 */
@Injectable()
export class WorldTypesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly types: WorldTypeFields,
    private readonly writes: WorldWrites,
    private readonly plugins: TypeFieldRegistry,
  ) {}

  /** The types available in a World (plugin + user-defined). Reachable-gated; unreachable → `not-found`. */
  listAvailable(userId: string, worldId: string): AvailableType[] | 'not-found' {
    if (!worldAccess(this.db, userId).decideMeta(worldId)?.reachable) return 'not-found';
    return this.types.availableTypes(worldId);
  }

  /** Author a new user-defined type (Owner-only). `conflict` if the id is already defined in the World. */
  create(userId: string, worldId: string, req: CreateUserDefinedTypeRequest): TypeResult<UserDefinedType> {
    const gate = this.gateOwner(userId, worldId);
    if (gate) return gate;
    if (this.types.list(worldId).some((type) => type.id === req.id)) return { status: 'conflict' };
    this.assertDataTypesResolve(req.fields);
    const type: UserDefinedType = { id: req.id, label: req.label, fields: req.fields, views: req.views };
    this.writes.createType(worldId, type);
    return { status: 'ok', value: type };
  }

  /**
   * Rename / re-Field a user-defined type (Owner-only). `not-found` if the World is unreachable or
   * the type id is not defined. The id is immutable — entities key off it.
   */
  update(
    userId: string,
    worldId: string,
    typeId: string,
    patch: UpdateUserDefinedTypeRequest,
  ): TypeResult<UserDefinedType> {
    const gate = this.gateOwner(userId, worldId);
    if (gate) return gate;
    if (patch.fields) this.assertDataTypesResolve(patch.fields);
    const stored = this.types.list(worldId).find((type) => type.id === typeId);
    if (!stored) return { status: 'not-found' };
    if (!this.writes.updateType(worldId, typeId, { ...patch, views: this.survivingViews(stored, patch) }))
      return { status: 'not-found' };
    // Just written in the same synchronous transaction, so it always resolves.
    return { status: 'ok', value: this.types.list(worldId).find((type) => type.id === typeId)! };
  }

  /**
   * The View list to write, so a placement never outlives the Field it names (ADR-0050, #201). The
   * payload schema checks a patch's `views` against its own `fields`, but a patch that re-Fields a
   * type *without* re-placing its Views can only be checked against the stored type — so it is
   * pruned here. `undefined` leaves the stored list alone.
   */
  private survivingViews(stored: UserDefinedType, patch: UpdateUserDefinedTypeRequest): ViewPlacement[] | undefined {
    if (patch.views) return patch.views;
    if (!patch.fields || !stored.views) return undefined;
    const keys = new Set(patch.fields.map((field) => field.key));
    return stored.views.filter((view) => !isFieldViewPlacement(view) || keys.has(view.field));
  }

  /**
   * Delete a user-defined type (Owner-only). Entities carrying it keep their Metadata as plain
   * values (a Field is a lens) — the drop de-types them without touching their bodies.
   */
  delete(userId: string, worldId: string, typeId: string): TypeResult<null> {
    const gate = this.gateOwner(userId, worldId);
    if (gate) return gate;
    return this.writes.deleteType(worldId, typeId) ? { status: 'ok', value: null } : { status: 'not-found' };
  }

  /**
   * A user-defined type's Fields may name a plugin's **Structured Field** data-type (`core.hex-grid`),
   * so authoring one is where an unregistered kind is rejected (ADR-0050) — against the composed set,
   * since no schema could enumerate a kind a plugin registers at module load.
   */
  private assertDataTypesResolve(fields: readonly FieldSchema[]): void {
    const errors = unresolvedDataTypeErrors(fields, this.plugins.structuredDataTypes);
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

/** The outcome of a type mutation — the controller maps each status to its HTTP code. */
export type TypeResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'not-found' }
  | { status: 'forbidden' }
  | { status: 'conflict' };
