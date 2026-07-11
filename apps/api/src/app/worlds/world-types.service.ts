import { Injectable, Inject } from '@nestjs/common';
import {
  AvailableType,
  CreateUserDefinedTypeRequest,
  UpdateUserDefinedTypeRequest,
  UserDefinedType,
} from '@hexly/domain';
import { DB, Db } from '../db/db';
import { worldAccess } from '../acl/world-access';
import { WorldTypeFields } from '../entities/world-type-fields';
import { WorldWrites } from './world-writes';

/**
 * A World's user-defined type CRUD, plus the per-World available-types read (ADR-0048, #191). The
 * Type-Definition peer of the membership/pins management on {@link WorldsService}: the read is
 * reachable-gated (any World member needs the type set for the create dialog, facets, and view
 * resolution), the mutations are **World-Owner-gated** (a non-Owner is refused), and every write
 * routes through {@link WorldWrites}, the World write choke point, so a type change bumps the
 * World's `seq` and nudges its followers.
 *
 * A World's user-defined types are read only through *that* World's id, so they never appear in
 * another World — World scoping falls out of {@link WorldTypeFields}'s keyed read.
 */
@Injectable()
export class WorldTypesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly types: WorldTypeFields,
    private readonly writes: WorldWrites,
  ) {}

  /**
   * The Entity Types **available in a World**: the instance-wide plugin types plus this World's
   * user-defined types. Reachable-gated — anyone who can reach the World may read its type set;
   * unreachable ≡ missing → `not-found`.
   */
  listAvailable(userId: string, worldId: string): AvailableType[] | 'not-found' {
    if (!worldAccess(this.db, userId).decideMeta(worldId)?.reachable) return 'not-found';
    return this.types.availableTypes(worldId);
  }

  /**
   * Author a new user-defined type (Owner-only). `conflict` if the id is already defined in the
   * World — the id is the Entity Type key entities carry, so it must be unique per World.
   */
  create(userId: string, worldId: string, req: CreateUserDefinedTypeRequest): TypeResult<UserDefinedType> {
    const gate = this.gateOwner(userId, worldId);
    if (gate) return gate;
    if (this.types.list(worldId).some((type) => type.id === req.id)) return { status: 'conflict' };
    const type: UserDefinedType = { id: req.id, label: req.label, fields: req.fields };
    this.writes.createType(worldId, type);
    return { status: 'ok', value: type };
  }

  /**
   * Rename / re-Field a user-defined type (Owner-only). `not-found` if the World is unreachable or
   * the type id is not defined in it (both a 404). The id itself is immutable — entities key off it.
   */
  update(
    userId: string,
    worldId: string,
    typeId: string,
    patch: UpdateUserDefinedTypeRequest,
  ): TypeResult<UserDefinedType> {
    const gate = this.gateOwner(userId, worldId);
    if (gate) return gate;
    if (!this.writes.updateType(worldId, typeId, patch)) return { status: 'not-found' };
    // The row was just written in the same synchronous transaction, so it always resolves here.
    return { status: 'ok', value: this.types.list(worldId).find((type) => type.id === typeId)! };
  }

  /**
   * Delete a user-defined type (Owner-only). `not-found` if the World is unreachable or the type id
   * is not defined. Entities carrying the type keep their Metadata as plain values (a Field is a
   * lens) — the drop de-types them without touching their bodies.
   */
  delete(userId: string, worldId: string, typeId: string): TypeResult<null> {
    const gate = this.gateOwner(userId, worldId);
    if (gate) return gate;
    return this.writes.deleteType(worldId, typeId) ? { status: 'ok', value: null } : { status: 'not-found' };
  }

  /**
   * Gate a type mutation: undefined when `userId` owns `worldId`, else the failing result —
   * unreachable → `not-found` (404), reachable-but-not-Owner → `forbidden` (403), the same
   * no-existence-leak split the World management endpoints use.
   */
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
