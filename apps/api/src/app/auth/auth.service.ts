import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { eq, lt } from 'drizzle-orm';
import {
  AuthUser,
  Preferences,
  PreferencesPatch,
  preferencesSchema,
} from '@hexly/domain';
import { DB, Db } from '../db/db';
import { sessions, users } from '../db/schema';

/** How long a session stays valid before `authenticate` rejects it. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** An unguessable opaque token for a cookie/session id. */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Under NODE_ENV=test (set by vitest), drop argon2 to a throwaway cost — still a
 * real `$argon2` hash, just cheap — so parallel auth-heavy specs don't blow their
 * timeouts. Production keeps the memory-hard defaults.
 */
const HASH_OPTIONS: Parameters<typeof hash>[1] | undefined =
  process.env.NODE_ENV === 'test'
    ? { memoryCost: 512, timeCost: 2, parallelism: 1, outputLen: 32 }
    : undefined;

/**
 * A precomputed argon2 hash verified against when no user matches, so the
 * unknown-email path costs roughly the same as the wrong-password path and
 * response timing cannot be used to enumerate which emails exist.
 */
const DUMMY_PASSWORD_HASH = hash('hexly-dummy-password', HASH_OPTIONS);

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
   * Provision a user out-of-band (no public signup): the seed CLI, the
   * `--superadmin` setup path, and the Instance Admin's create-user endpoint all
   * route through here. The password is hashed with argon2; the plaintext is
   * never stored. All `roles` default off.
   */
  async seedUser(
    email: string,
    password: string,
    displayName: string,
    roles: {
      isAdmin?: boolean;
      isSuperadmin?: boolean;
      canCreateWorlds?: boolean;
    } = {},
  ): Promise<string> {
    const id = randomUUID();
    const passwordHash = await hash(password, HASH_OPTIONS);
    this.db
      .insert(users)
      .values({
        id,
        email: normalizeEmail(email),
        displayName,
        passwordHash,
        isAdmin: roles.isAdmin ?? false,
        isSuperadmin: roles.isSuperadmin ?? false,
        canCreateWorlds: roles.canCreateWorlds ?? false,
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

    // Verify against the real hash or the dummy to equalize timing (no email
    // enumeration). A throw is treated as auth failure, not a 500.
    let passwordOk = false;
    try {
      const targetHash = user ? user.passwordHash : await DUMMY_PASSWORD_HASH;
      passwordOk = await verify(targetHash, password);
    } catch {
      return null;
    }
    if (!user || !passwordOk) return null;
    // A disabled account cannot open a session; checked after the password verify
    // so timing doesn't reveal disabled accounts.
    if (user.disabledAt !== null) return null;

    // Opportunistic sweep on login to prevent unbounded table growth.
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
    if (!user) return null;
    // A disabled account's live sessions stop resolving immediately — disable is
    // the immediate lever, not just a future-login block.
    if (user.disabledAt !== null) return null;
    return toAuthUser(user);
  }

  /**
   * Merge a Preferences patch into the user's stored bag and return the merged
   * result. PATCH semantics: absent fields keep their stored value, an explicit
   * `null` clears a field back to "no choice".
   */
  async updatePreferences(
    userId: string,
    patch: PreferencesPatch,
  ): Promise<Preferences> {
    const row = this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .get();
    const merged: Record<string, unknown> = {
      ...parsePreferences(row?.preferences ?? '{}'),
    };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete merged[key];
      else if (value !== undefined) merged[key] = value;
    }
    this.db
      .update(users)
      .set({ preferences: JSON.stringify(merged) })
      .where(eq(users.id, userId))
      .run();
    return merged as Preferences;
  }

  /** Update the user's display name and return their fresh {@link AuthUser}. */
  async updateProfile(userId: string, displayName: string): Promise<AuthUser> {
    this.db
      .update(users)
      .set({ displayName })
      .where(eq(users.id, userId))
      .run();
    const row = this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (!row) throw new Error(`user ${userId} vanished mid-session`);
    return toAuthUser(row);
  }

  /**
   * Change the user's password: verify the current one, then re-hash and store
   * the new one. Returns `false` — with nothing written — when the current
   * password does not verify. The user's other sessions stay valid.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    const row = this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (!row) return false;

    let currentOk = false;
    try {
      currentOk = await verify(row.passwordHash, currentPassword);
    } catch {
      return false;
    }
    if (!currentOk) return false;

    const passwordHash = await hash(newPassword, HASH_OPTIONS);
    this.db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, userId))
      .run();
    return true;
  }

  /**
   * Set a user's password unconditionally — the Instance Admin reset path, which
   * carries no current-password check because the Admin acts on the user's behalf.
   */
  async setPassword(userId: string, newPassword: string): Promise<void> {
    const passwordHash = await hash(newPassword, HASH_OPTIONS);
    this.db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
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
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    preferences: parsePreferences(row.preferences),
    isAdmin: row.isAdmin,
    isSuperadmin: row.isSuperadmin,
    canCreateWorlds: row.canCreateWorlds,
  };
}

/**
 * Parse the stored Preferences JSON through the domain schema. A corrupt or
 * hand-edited bag degrades to app defaults rather than breaking auth.
 */
function parsePreferences(raw: string): Preferences {
  try {
    const parsed = preferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}
