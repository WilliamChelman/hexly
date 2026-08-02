import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

/**
 * What a World-scoped service answers a route with, generic over the `ok` payload — the peer of
 * `AclSetResult` for the routes that carry no owner-set invariant. `not-found` = no such World, or one
 * the caller can't reach (404, ADR-0004 — existence never leaks); `forbidden` = reachable but the
 * caller may not do this (403); `invalid` = a well-formed request that is not one (400); `conflict` =
 * an id already taken (409).
 */
export type WorldRouteResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'not-found' }
  | { status: 'forbidden' }
  | { status: 'invalid' }
  | { status: 'conflict' };

/** The refusal arms alone — what a gate returns, and what `gate` already produces. */
export type WorldRouteRefusal = Extract<WorldRouteResult<never>, { status: 'not-found' | 'forbidden' }>;

/** Map a {@link WorldRouteResult} to its HTTP outcome: `ok` unwraps, else the status's exception. */
export function worldRouteResponse<T>(result: WorldRouteResult<T>): T {
  switch (result.status) {
    case 'ok':
      return result.value;
    case 'not-found':
      throw new NotFoundException();
    case 'forbidden':
      throw new ForbiddenException();
    case 'invalid':
      throw new BadRequestException();
    case 'conflict':
      throw new ConflictException();
  }
}
