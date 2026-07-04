import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Db } from '../db/db';
import { users } from '../db/schema';

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
 * Map an ACL-set outcome to its HTTP shape: the payload on success, or the 4xx the
 * failure reason names. `conflictMessage` is the 409 body — the one line that varies by
 * caller (which resource must keep an Owner), so it stays a parameter.
 */
export function aclSetResponse<T>(result: AclSetResult<T>, conflictMessage: string): T {
  switch (result.status) {
    case 'ok':
      return result.value;
    case 'not-found':
      throw new NotFoundException();
    case 'forbidden':
      throw new ForbiddenException();
    case 'no-such-user':
      throw new BadRequestException('No such user');
    case 'last-owner':
      throw new ConflictException(conflictMessage);
  }
}

/** An ownership-set outcome (ADR-0037): the `ok` payload is the Owner id list. */
export type OwnerSetResult = AclSetResult<string[]>;

/**
 * The 409 body when the ≥1-Owner invariant refuses emptying a resource's owner set
 * (ADR-0037). The single source for both the owner-set and member routes — the member
 * DELETE can raise the same World invariant, so the literal must not drift between them.
 */
export function lastOwnerMessage(kind: 'World' | 'Entity'): string {
  return `${kind === 'World' ? 'A World' : 'An Entity'} must keep at least one Owner`;
}

/**
 * Map an owner-set outcome to its HTTP shape (the updated Owner set). A thin wrapper over
 * {@link aclSetResponse} that tailors the 409 message by resource `kind`.
 */
export function ownerSetResponse(result: OwnerSetResult, kind: 'World' | 'Entity'): string[] {
  return aclSetResponse(result, lastOwnerMessage(kind));
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
