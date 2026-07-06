import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AclErrorCode, AclResourceKind, ApiError } from '@hexly/domain';
import { and, eq, sql } from 'drizzle-orm';
import { Db } from '../db/db';
import { entityGrants, users, worldMembers } from '../db/schema';

/**
 * The outcome of an ACL "set" mutation (ADR-0037) — an ownership set or a membership
 * set on a World or Entity — generic over the payload the `ok` case carries (Owner ids,
 * member rows). Mapped to HTTP by {@link aclSetResponse}: `not-found` → 404 (caller can't
 * reach the target), `forbidden` → 403 (reachable but not permitted), `no-such-user` →
 * the target isn't an Instance user (400), `last-owner` → the ≥1-Owner invariant refused
 * emptying the set (409).
 */
export type AclSetResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'not-found' }
  | { status: 'forbidden' }
  | { status: 'no-such-user' }
  | { status: 'last-owner' };

/**
 * Map an ACL-set outcome to its HTTP shape: the payload on success, or the 4xx the failure
 * reason names, as a structured `{ code }` body — never prose (ADR-0037, #163). `kind` names
 * the resource for the `last-owner` conflict's `data` (a World or Entity must keep ≥1 Owner);
 * routes with no owner invariant (links, grants) never reach that arm but still pass their
 * own kind, which is harmless.
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
      throw new BadRequestException({ code: AclErrorCode.NoSuchUser } satisfies ApiError);
    case 'last-owner':
      throw new ConflictException({
        code: AclErrorCode.LastOwner,
        data: { kind },
      } satisfies ApiError);
  }
}

/** An ownership-set outcome (ADR-0037): the `ok` payload is the Owner id list. */
export type OwnerSetResult = AclSetResult<string[]>;

/**
 * Map an owner-set outcome to its HTTP shape (the updated Owner set). A thin, named alias
 * of {@link aclSetResponse} for the owner-set routes — the `kind` tags the `last-owner` body.
 */
export function ownerSetResponse(result: OwnerSetResult, kind: AclResourceKind): string[] {
  return aclSetResponse(result, kind);
}

/**
 * Whether `userId` is an existing Instance user — the target-must-exist guard both
 * owner-set `addOwner` paths share (ADR-0037), so the check can't drift between the
 * World and Entity services.
 */
export function userExists(db: Db, userId: string): boolean {
  return !!db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
}

/**
 * Whether `userId` is the *sole* Owner of any World or Entity (ADR-0037, #163) — the
 * ≥1-Owner invariant extended to account deletion, so orphans are impossible by
 * construction: deleting a user is refused while this holds. A resource counts when the
 * user holds its `owner` role AND it has exactly one owner. Worlds carry ownership in
 * `world_members`, Entities in `entity_grants` (owner folded in, migration 0007) — the
 * same shape, checked once each.
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
 * The ≥1-Owner invariant for `removeOwner` (ADR-0037), as a pure decision over the
 * *current* owner set — shared by both services so the rule can't diverge. `not-found`
 * if the target isn't an Owner, `last-owner` if it's the only one, else `ok` with the
 * post-removal set. On `ok` the caller performs the delete; the returned set is
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
 * Whether `userId` is a Superadmin (ADR-0037, #163) — the operator's in-app self, outside
 * the collaboration model. Resolved once per request and handed to the predicates, which
 * short-circuit to match-all: one indexed PK lookup versus a per-row `users` subquery bolted
 * onto every predicate. Both the Entity and World access contexts share this one definition
 * so the repair bypass can't drift between them.
 */
export function isSuperadmin(db: Db, userId: string): boolean {
  return !!db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isSuperadmin, true)))
    .get();
}

/**
 * The shared owner-management gate (ADR-0037): the no-existence-leak split every owner/link/
 * grant endpoint routes through, fed a resolved `{ reachable, isOwner }`. `not-found` when the
 * resource is unreachable — indistinguishable from missing (404, ADR-0004) — `forbidden` when
 * it's reachable but the caller isn't an Owner (403), else `undefined` = proceed (composes with
 * `return gate(...) ?? { status: 'ok', … }`). One rule, so the two services can't diverge.
 */
export function gate(outcome: {
  reachable: boolean;
  isOwner: boolean;
}): Extract<AclSetResult<never>, { status: 'not-found' | 'forbidden' }> | undefined {
  if (!outcome.reachable) return { status: 'not-found' };
  if (!outcome.isOwner) return { status: 'forbidden' };
  return undefined;
}
