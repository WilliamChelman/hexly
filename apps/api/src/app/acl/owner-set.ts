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
 * Outcome of an owner-set mutation on a World or Entity (ADR-0037, #158), mapped
 * to HTTP status by {@link ownerSetResponse}: the updated Owner set on success, or
 * the reason a 4xx describes. `not-found` → 404 (caller can't reach the target),
 * `forbidden` → 403 (reachable but not an Owner), `no-such-user` → the target isn't
 * an Instance user, `last-owner` → the ≥1-Owner invariant refused emptying the set.
 */
export type OwnerSetResult =
  | { status: 'ok'; owners: string[] }
  | { status: 'not-found' }
  | { status: 'forbidden' }
  | { status: 'no-such-user' }
  | { status: 'last-owner' };

/**
 * Map an owner-set outcome to its HTTP shape: the updated set, or the 4xx the
 * failure reason names. `kind` ('World' | 'Entity') only tailors the 409 message.
 */
export function ownerSetResponse(result: OwnerSetResult, kind: 'World' | 'Entity'): string[] {
  switch (result.status) {
    case 'ok':
      return result.owners;
    case 'not-found':
      throw new NotFoundException();
    case 'forbidden':
      throw new ForbiddenException();
    case 'no-such-user':
      throw new BadRequestException('No such user');
    case 'last-owner':
      throw new ConflictException(`${kind === 'World' ? 'A World' : 'An Entity'} must keep at least one Owner`);
  }
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
 * post-removal set. On `ok` the caller performs the delete; the returned `owners` is
 * already the target-removed set, so no re-read after the delete is needed.
 */
export function removeOwnerOutcome(
  owners: string[],
  targetUserId: string,
): Extract<OwnerSetResult, { status: 'ok' | 'not-found' | 'last-owner' }> {
  if (!owners.includes(targetUserId)) return { status: 'not-found' };
  if (owners.length === 1) return { status: 'last-owner' };
  return { status: 'ok', owners: owners.filter((u) => u !== targetUserId) };
}
