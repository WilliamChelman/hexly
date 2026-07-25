import { randomBytes } from 'node:crypto';
import { INSTANCE_ROLES } from '@hexly/domain';
import type { AuthService } from '../../api/src/host';

/** The slice of the API's auth service main needs to hold the Sole User's identity (ADR-0070). */
export type SoleUserAuth = Pick<AuthService, 'findUserIdByEmail' | 'seedUser' | 'mintSession' | 'logoutAll' | 'logout'>;

/**
 * The Sole User's address. A real `users` row is required: grant and member rows are `NOT NULL` with foreign
 * keys to a user (ADR-0070). `.localhost` is reserved (RFC 6761), so it cannot collide with a real address.
 */
export const SOLE_USER_EMAIL = 'you@hexly.localhost';

/** `display_name` is `NOT NULL`; the desktop profile shows it as identity nowhere (ADR-0071, #318). */
export const SOLE_USER_DISPLAY_NAME = 'You';

/** The furthest instant a JS `Date` holds: an identity with no password cannot re-authenticate (ADR-0070). */
export const NO_EXPIRY = 8_640_000_000_000_000;

/**
 * Provision-or-reuse the Sole User and open its session, returning the token main writes into the renderer's
 * cookie jar. A genuine session rather than a guard change: resolving the Sole User from an *absent* cookie
 * would serve every web page the user visits (ADR-0070).
 */
export async function openSoleUserSession(auth: SoleUserAuth): Promise<string> {
  const userId = await ensureSoleUser(auth);
  // A crash quits without revoking and no sweep can reap a no-expiry row, so clear what the last launch left.
  await auth.logoutAll(userId);
  return auth.mintSession(userId, { expiresAt: NO_EXPIRY });
}

/** Revoke the launch session, so quitting leaves no usable credential behind (ADR-0070). */
export async function closeSoleUserSession(auth: SoleUserAuth, token: string): Promise<void> {
  await auth.logout(token);
}

/** Idempotent like the seed CLI (ADR-0004): seed only if absent, so a second launch keeps its Worlds. */
async function ensureSoleUser(auth: SoleUserAuth): Promise<string> {
  const existing = auth.findUserIdByEmail(SOLE_USER_EMAIL);
  if (existing) return existing;
  return auth.seedUser(SOLE_USER_EMAIL, unknowablePassword(), SOLE_USER_DISPLAY_NAME, {
    // Superadmin and every Instance Role, so no predicate denies the only user there is (ADR-0071).
    isSuperadmin: true,
    roles: [...INSTANCE_ROLES],
  });
}

/** `password_hash` is `NOT NULL`, so "no password exists anywhere" (ADR-0070) is a secret nobody keeps. */
function unknowablePassword(): string {
  return randomBytes(32).toString('base64url');
}
