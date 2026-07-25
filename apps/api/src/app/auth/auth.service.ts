import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { eq, lt } from 'drizzle-orm';
import {
  AuthUser,
  InstanceRole,
  instanceRolesSchema,
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
 * Under NODE_ENV=test (set by vitest), the native argon2 addon is skipped entirely:
 * its CPU contention under parallel workers makes auth-heavy specs flaky.
 */
const isTest = process.env.NODE_ENV === 'test';

/** Cheap, non-reversible test stand-in: sha256, not the plaintext, so the
 *  "never stores plaintext" spec still holds. `$argon2` prefix keeps shape checks green. */
function testHash(password: string): string {
  return `$argon2-test$${createHash('sha256').update(password).digest('hex')}`;
}

function hashPassword(password: string): Promise<string> {
  return isTest ? Promise.resolve(testHash(password)) : hash(password);
}
function verifyPassword(stored: string, password: string): Promise<boolean> {
  return isTest ? Promise.resolve(stored === testHash(password)) : verify(stored, password);
}

/**
 * Verified against when no user matches, so the unknown-email path costs roughly the
 * same as the wrong-password path and timing cannot enumerate which emails exist.
 */
const DUMMY_PASSWORD_HASH = hashPassword('hexly-dummy-password');

@Injectable()
export class AuthService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Provision a user out-of-band (there is no public signup). The plaintext password
   * is never stored. Roles default to the empty set and Superadmin to off.
   */
  async seedUser(
    email: string,
    password: string,
    displayName: string,
    opts: {
      roles?: readonly InstanceRole[];
      isSuperadmin?: boolean;
    } = {},
  ): Promise<string> {
    const id = randomUUID();
    const passwordHash = await hashPassword(password);
    this.db
      .insert(users)
      .values({
        id,
        email: normalizeEmail(email),
        displayName,
        passwordHash,
        roles: JSON.stringify(opts.roles ?? []),
        isSuperadmin: opts.isSuperadmin ?? false,
        createdAt: Date.now(),
      })
      .run();
    return id;
  }

  /**
   * Verify credentials and open a session, or `null` if the email is unknown or the
   * password is wrong. Both failure paths are timing-equalized: an unknown email still
   * runs a verify against a dummy hash, so timing reveals neither which check failed
   * nor which emails exist.
   */
  async login(email: string, password: string): Promise<{ token: string; user: AuthUser } | null> {
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
      passwordOk = await verifyPassword(targetHash, password);
    } catch {
      return null;
    }
    if (!user || !passwordOk) return null;
    // A disabled account cannot open a session; checked after the password verify
    // so timing doesn't reveal disabled accounts.
    if (user.disabledAt !== null) return null;

    // Opportunistic sweep on login to prevent unbounded table growth.
    this.purgeExpiredSessions();

    return { token: this.mintSession(user.id), user: toAuthUser(user) };
  }

  /**
   * Open a session with no credential check, for a caller whose identity is already established: the Desktop
   * App mints the Sole User's at launch (ADR-0070), so no route special-cases loopback. `expiresAt` defaults
   * to the standard TTL.
   */
  mintSession(userId: string, opts: { expiresAt?: number } = {}): string {
    const token = newToken();
    this.db
      .insert(sessions)
      .values({
        id: token,
        userId,
        createdAt: Date.now(),
        expiresAt: opts.expiresAt ?? Date.now() + SESSION_TTL_MS,
      })
      .run();
    return token;
  }

  /** How a caller with no password provisions-or-reuses a user (the Desktop App's Sole User, ADR-0070). */
  findUserIdByEmail(email: string): string | undefined {
    return this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizeEmail(email)))
      .get()?.id;
  }

  /** Resolve a session token to its user, or `null` if missing/expired. */
  async authenticate(token: string | undefined): Promise<AuthUser | null> {
    if (!token) return null;
    const session = this.db.select().from(sessions).where(eq(sessions.id, token)).get();
    if (!session || session.expiresAt < Date.now()) return null;

    const user = this.db.select().from(users).where(eq(users.id, session.userId)).get();
    if (!user) return null;
    // A disabled account's live sessions stop resolving immediately — disable is
    // the immediate lever, not just a future-login block.
    if (user.disabledAt !== null) return null;
    return toAuthUser(user);
  }

  /**
   * PATCH semantics: an absent field keeps its stored value, an explicit `null` clears
   * the field back to "no choice".
   */
  async updatePreferences(userId: string, patch: PreferencesPatch): Promise<Preferences> {
    const row = this.db.select().from(users).where(eq(users.id, userId)).get();
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
    this.db.update(users).set({ displayName }).where(eq(users.id, userId)).run();
    const row = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!row) throw new Error(`user ${userId} vanished mid-session`);
    return toAuthUser(row);
  }

  /**
   * Returns `false` — with nothing written — when the current password does not
   * verify. The user's other sessions stay valid.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
    const row = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!row) return false;

    let currentOk = false;
    try {
      currentOk = await verifyPassword(row.passwordHash, currentPassword);
    } catch {
      return false;
    }
    if (!currentOk) return false;

    const passwordHash = await hashPassword(newPassword);
    this.db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
    return true;
  }

  /** Set a user's password unconditionally: the Instance Admin reset path, with no current-password check. */
  async setPassword(userId: string, newPassword: string): Promise<void> {
    const passwordHash = await hashPassword(newPassword);
    this.db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
  }

  /** End a session by deleting its row; a no-op for an unknown token. */
  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    this.db.delete(sessions).where(eq(sessions.id, token)).run();
  }

  /** End every session a user holds. The Desktop App clears the Sole User's on launch (ADR-0070). */
  async logoutAll(userId: string): Promise<void> {
    this.db.delete(sessions).where(eq(sessions.userId, userId)).run();
  }

  /** Delete every session whose expiry has passed. Safe to call any time. */
  purgeExpiredSessions(): void {
    this.db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
  }
}

/** Canonical form for both storage and lookup: login is case- and whitespace-insensitive. */
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
    roles: parseRoles(row.roles),
    isSuperadmin: row.isSuperadmin,
  };
}

/** A corrupt or hand-edited set degrades to no roles rather than breaking auth. */
function parseRoles(raw: string): InstanceRole[] {
  try {
    const parsed = instanceRolesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** A corrupt or hand-edited bag degrades to app defaults rather than breaking auth. */
function parsePreferences(raw: string): Preferences {
  try {
    const parsed = preferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}
