import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { eq, lt } from 'drizzle-orm';
import { AuthUser } from '@hexly/domain';
import { DB, Db } from '../db/db';
import { sessions, users } from '../db/schema';

/** How long a session stays valid before `authenticate` rejects it. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** An unguessable opaque token for a cookie/session id. */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * A precomputed argon2 hash verified against when no user matches, so the
 * unknown-email path costs roughly the same as the wrong-password path and
 * response timing cannot be used to enumerate which emails exist.
 */
const DUMMY_PASSWORD_HASH = hash('hexly-dummy-password');

/**
 * The auth domain behind a small interface: provisioning members of the closed
 * set, exchanging credentials for a session, resolving a session back to its
 * user, and ending one. All hashing, token minting, and persistence live here;
 * callers only ever hold opaque tokens and {@link AuthUser} values.
 */
@Injectable()
export class AuthService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Provision a user out-of-band (ADR-0004 — no public signup). The password is
   * hashed with argon2; the plaintext is never stored.
   */
  async seedUser(
    email: string,
    password: string,
    displayName: string,
  ): Promise<string> {
    const id = randomUUID();
    const passwordHash = await hash(password);
    this.db
      .insert(users)
      .values({
        id,
        email: normalizeEmail(email),
        displayName,
        passwordHash,
        createdAt: Date.now(),
      })
      .run();
    return id;
  }

  /**
   * Verify credentials and open a session. Returns the new session token plus
   * the user on success, or `null` if the email is unknown or the password is
   * wrong. The two failure paths are timing-equalized: an unknown email still
   * runs an argon2 verify against a dummy hash, so the caller cannot tell which
   * failed (nor enumerate emails) by response timing.
   */
  async login(
    email: string,
    password: string,
  ): Promise<{ token: string; user: AuthUser } | null> {
    const user = this.db
      .select()
      .from(users)
      .where(eq(users.email, normalizeEmail(email)))
      .get();

    // Verify against the real hash when the email is known, or a constant dummy
    // hash otherwise, so both paths take comparable time. A throw (e.g. a
    // malformed stored hash) is treated as an auth failure, never a 500.
    let passwordOk = false;
    try {
      const targetHash = user ? user.passwordHash : await DUMMY_PASSWORD_HASH;
      passwordOk = await verify(targetHash, password);
    } catch {
      return null;
    }
    if (!user || !passwordOk) return null;

    // Opportunistic sweep: login is the natural low-frequency moment to clear
    // out sessions whose lifetime has passed, so the table can't grow unbounded
    // without a separate job (ADR-0002 — this stays a tiny single-file DB).
    this.purgeExpiredSessions();

    const token = newToken();
    this.db
      .insert(sessions)
      .values({
        id: token,
        userId: user.id,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TTL_MS,
      })
      .run();

    return { token, user: toAuthUser(user) };
  }

  /** Resolve a session token to its user, or `null` if missing/expired. */
  async authenticate(token: string | undefined): Promise<AuthUser | null> {
    if (!token) return null;
    const session = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, token))
      .get();
    if (!session || session.expiresAt < Date.now()) return null;

    const user = this.db
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .get();
    return user ? toAuthUser(user) : null;
  }

  /** End a session by deleting its row; a no-op for an unknown token. */
  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    this.db.delete(sessions).where(eq(sessions.id, token)).run();
  }

  /** Delete every session whose expiry has passed. Safe to call any time. */
  purgeExpiredSessions(): void {
    this.db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
  }
}

/**
 * Canonicalize an email for storage and lookup so a user seeded as
 * `ada@hexly.test` can still log in typing `Ada@hexly.test` or with stray
 * whitespace.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Strip a user row down to the public {@link AuthUser} shape. */
function toAuthUser(row: typeof users.$inferSelect): AuthUser {
  return { id: row.id, email: row.email, displayName: row.displayName };
}
