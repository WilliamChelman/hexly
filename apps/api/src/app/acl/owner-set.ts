import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AclErrorCode, AclResourceKind, ApiError } from '@hexly/domain';
import { and, eq, sql } from 'drizzle-orm';
import { Db } from '../db/db';
import { entityGrants, users, worldMembers } from '../db/schema';

/**
 * The outcome of an ACL "set" mutation (ADR-0037) — an ownership or membership set on a
 * World or Entity — generic over the `ok` payload. Mapped to HTTP by {@link aclSetResponse}:
 * `not-found` = caller can't reach the target (404), `forbidden` = reachable but not
 * permitted (403), `no-such-user` = the target isn't an Instance user (400), `last-owner` =
 * the ≥1-Owner invariant refused emptying the set (409).
 */
export type AclSetResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'not-found' }
  | { status: 'forbidden' }
  | { status: 'no-such-user' }
  | { status: 'last-owner' };

/**
 * Map an ACL-set outcome to its HTTP shape: the payload on success, else the 4xx the failure
 * reason names, as a structured `{ code }` body — never prose. `kind` tags the `last-owner`
 * conflict's `data`; routes with no owner invariant (links, grants) never reach that arm.
 */
export function aclSetResponse<T>(result: AclSetResult<T>, kind: AclResourceKind): T {
  switch (result.status) {
    case 'ok':
      return result.value;
    case 'not-found':
      throw new NotFoundException();
    case 'forbidden':
      throw new ForbiddenException();
    case 'no-such-user':
      throw new BadRequestException({
        code: AclErrorCode.NoSuchUser,
      } satisfies ApiError);
    case 'last-owner':
      throw new ConflictException({
        code: AclErrorCode.LastOwner,
        data: { kind },
      } satisfies ApiError);
  }
}

/** An ownership-set outcome (ADR-0037): the `ok` payload is the Owner id list. */
export type OwnerSetResult = AclSetResult<string[]>;

/** {@link aclSetResponse} for the owner-set routes: the `ok` payload is the updated Owner set. */
export function ownerSetResponse(result: OwnerSetResult, kind: AclResourceKind): string[] {
  return aclSetResponse(result, kind);
}

export function userExists(db: Db, userId: string): boolean {
  return !!db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
}

/**
 * Whether `userId` is the *sole* Owner of any World or Entity: deleting a user is refused
 * while this holds (the ≥1-Owner invariant, ADR-0037). A resource counts when the user holds
 * its `owner` role AND it has exactly one owner. Worlds carry ownership in `world_members`,
 * Entities in `entity_grants`.
 */
export function solelyOwnsAnything(db: Db, userId: string): boolean {
  const soleWorld = db
    .select({ n: sql<number>`1` })
    .from(worldMembers)
    .where(
      sql`${worldMembers.userId} = ${userId} AND ${worldMembers.role} = 'owner'
        AND (SELECT count(*) FROM ${worldMembers} o
             WHERE o.world_id = ${worldMembers.worldId} AND o.role = 'owner') = 1`,
    )
    .get();
  if (soleWorld) return true;
  const soleEntity = db
    .select({ n: sql<number>`1` })
    .from(entityGrants)
    .where(
      sql`${entityGrants.userId} = ${userId} AND ${entityGrants.role} = 'owner'
        AND (SELECT count(*) FROM ${entityGrants} o
             WHERE o.entity_id = ${entityGrants.entityId} AND o.role = 'owner') = 1`,
    )
    .get();
  return !!soleEntity;
}

/**
 * The ≥1-Owner invariant for `removeOwner` (ADR-0037), as a pure decision over the *current*
 * owner set: `not-found` if the target isn't an Owner, `last-owner` if it's the only one, else
 * `ok` with the post-removal set. On `ok` the caller performs the delete; the returned set is
 * already the target-removed one, so no re-read after the delete is needed.
 */
export function removeOwnerOutcome(
  owners: string[],
  targetUserId: string,
): Extract<OwnerSetResult, { status: 'ok' | 'not-found' | 'last-owner' }> {
  if (!owners.includes(targetUserId)) return { status: 'not-found' };
  if (owners.length === 1) return { status: 'last-owner' };
  return { status: 'ok', value: owners.filter((u) => u !== targetUserId) };
}

/**
 * Whether `userId` is a Superadmin (ADR-0037) — the operator's in-app self, outside the
 * collaboration model. Resolve once per request and hand it to the predicates, which
 * short-circuit to match-all; the alternative is a per-row `users` subquery on every predicate.
 */
export function isSuperadmin(db: Db, userId: string): boolean {
  return !!db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isSuperadmin, true)))
    .get();
}

/**
 * The shared owner-management gate (ADR-0037), fed a resolved `{ reachable, isOwner }`:
 * `not-found` when the resource is unreachable — indistinguishable from missing, so existence
 * doesn't leak (404, ADR-0004) — `forbidden` when reachable but the caller isn't an Owner (403),
 * else `undefined` = proceed (composes with `return gate(...) ?? { status: 'ok', … }`).
 */
export function gate(outcome: {
  reachable: boolean;
  isOwner: boolean;
}): Extract<AclSetResult<never>, { status: 'not-found' | 'forbidden' }> | undefined {
  if (!outcome.reachable) return { status: 'not-found' };
  if (!outcome.isOwner) return { status: 'forbidden' };
  return undefined;
}
