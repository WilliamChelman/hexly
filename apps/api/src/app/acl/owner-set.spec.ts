import { describe, expect, it } from 'vitest';
import { gate, removeOwnerOutcome } from './owner-set';

/**
 * `gate` is the shared owner-management outcome (ADR-0037, #163): the one place the
 * no-existence-leak split lives. An unreachable resource is indistinguishable from a
 * missing one (404, ADR-0004); a reachable one the caller doesn't own is a 403;
 * otherwise the caller may proceed (`undefined`, composing with `return gate ?? ok`).
 */
describe('gate', () => {
  it('is not-found when the resource is unreachable', () => {
    expect(gate({ reachable: false, isOwner: false })).toEqual({
      status: 'not-found',
    });
  });

  it('hides ownership behind reachability — unreachable owner is still not-found', () => {
    expect(gate({ reachable: false, isOwner: true })).toEqual({
      status: 'not-found',
    });
  });

  it('is forbidden when reachable but not an Owner', () => {
    expect(gate({ reachable: true, isOwner: false })).toEqual({
      status: 'forbidden',
    });
  });

  it('proceeds (undefined) when reachable and an Owner', () => {
    expect(gate({ reachable: true, isOwner: true })).toBeUndefined();
  });
});

/**
 * The ≥1-Owner invariant for `removeOwner` (ADR-0037), as a pure decision over the current
 * owner set — shared by the World and Entity services so the rule can't diverge, and reused for
 * the member-removal last-owner guard.
 */
describe('removeOwnerOutcome', () => {
  it('is not-found when the target is not an Owner', () => {
    expect(removeOwnerOutcome(['ada', 'bob'], 'carol')).toEqual({
      status: 'not-found',
    });
  });

  it('refuses to empty the set — the sole Owner is last-owner', () => {
    expect(removeOwnerOutcome(['ada'], 'ada')).toEqual({
      status: 'last-owner',
    });
  });

  it('removes the target and returns the post-removal set when others remain', () => {
    expect(removeOwnerOutcome(['ada', 'bob'], 'ada')).toEqual({
      status: 'ok',
      value: ['bob'],
    });
  });
});
