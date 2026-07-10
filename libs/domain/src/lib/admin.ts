/**
 * Instance Admin contracts shared by the API and the web panel. The Admin
 * surface manages accounts, so — unlike the public `UserSummary` directory —
 * it *does* carry the email: it is the login identity an Admin administers.
 */

import { z } from 'zod';
import { MIN_PASSWORD_LENGTH } from './auth';

/**
 * One account row in the admin panel (`GET /admin/users`). Carries the flags and
 * the disabled state the panel renders, plus the email (an Admin concern), but
 * never the password hash.
 */
export interface AdminUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly isAdmin: boolean;
  readonly isSuperadmin: boolean;
  /** Whether this user may create Worlds. */
  readonly canCreateWorlds: boolean;
  /** Epoch ms the account was disabled, or null when active. */
  readonly disabledAt: number | null;
}

/**
 * The stable, structured reasons the Admin surface refuses a mutation. Returned
 * as `{ code }` in the 4xx body — never prose — so the web maps a code to
 * localized copy rather than string-matching English. The HTTP status still
 * carries the category (409 invariant conflict, 403 tier, 404 unknown).
 */
export const AdminErrorCode = {
  /** The email is already taken by another account. */
  EmailInUse: 'email-in-use',
  /** The target solely owns a World or Entity — reassign before deleting (≥1-Owner). */
  SoleOwner: 'sole-owner',
  /** Would drop the Superadmin set to zero (disable/demote/delete the last one). */
  LastSuperadmin: 'last-superadmin',
  /** You cannot delete your own account. */
  SelfDelete: 'self-delete',
  /** You cannot disable your own account. */
  SelfDisable: 'self-disable',
  /** You cannot remove your own Admin access. */
  SelfAdminRevoke: 'self-admin-revoke',
  /** Only a Superadmin may manage a Superadmin account. */
  SuperadminManaged: 'superadmin-managed-by-superadmin',
  /** No such account. */
  UserNotFound: 'user-not-found',
  /** A Reindex is already walking the instance — there is only ever one. */
  ReindexRunning: 'reindex-running',
} as const;

/** One of the {@link AdminErrorCode} values — the wire code in an Admin error body. */
export type AdminErrorCode = (typeof AdminErrorCode)[keyof typeof AdminErrorCode];

/** The structured body of an Admin 4xx: a stable code, plus optional data. */
export interface AdminError {
  readonly code: AdminErrorCode;
  readonly data?: Record<string, unknown>;
}

/** The body of `POST /admin/users` — provision a new account in the closed set. */
export const createUserRequestSchema = z
  .object({
    email: z.string().trim().min(1),
    password: z.string().min(MIN_PASSWORD_LENGTH),
    displayName: z.string().trim().min(1),
  })
  .strict();

/** A validated new-user request. */
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

/** The body of `POST /admin/users/:id/password` — an Admin-driven reset (no old password). */
export const resetPasswordRequestSchema = z
  .object({
    password: z.string().min(MIN_PASSWORD_LENGTH),
  })
  .strict();

/** A validated Admin password reset. */
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/** The body of `PATCH /admin/users/:id/admin` — set (or clear) the Instance Admin flag. */
export const setAdminRequestSchema = z.object({ isAdmin: z.boolean() }).strict();

/** A validated Admin-flag toggle. */
export type SetAdminRequest = z.infer<typeof setAdminRequestSchema>;

/** The body of `PATCH /admin/users/:id/can-create-worlds` — grant (or revoke) World Creation. */
export const setCanCreateWorldsRequestSchema = z
  .object({ canCreateWorlds: z.boolean() })
  .strict();

/** A validated World-Creation-capability toggle. */
export type SetCanCreateWorldsRequest = z.infer<
  typeof setCanCreateWorldsRequestSchema
>;

/** The body of `PATCH /admin/users/:id/disabled` — disable (or re-enable) the account. */
export const setDisabledRequestSchema = z.object({ disabled: z.boolean() }).strict();

/** A validated disabled-state toggle. */
export type SetDisabledRequest = z.infer<typeof setDisabledRequestSchema>;

/** The body of `PATCH /admin/users/:id/superadmin` — set (or clear) the Superadmin flag. */
export const setSuperadminRequestSchema = z
  .object({ isSuperadmin: z.boolean() })
  .strict();

/** A validated Superadmin-flag toggle. */
export type SetSuperadminRequest = z.infer<typeof setSuperadminRequestSchema>;

/**
 * One Entity the Reindex walked but could not derive — a document this build cannot parse. The
 * walk skips it and carries on, so a single unreadable document cannot deny the repair tool to
 * the instance that most needs it. The Superadmin gets the ids back precisely because a skipped
 * Entity is the one thing the operator must go look at by hand.
 */
export interface ReindexFailure {
  readonly entityId: string;
  readonly worldId: string;
  /** The thrown error's message, surfaced verbatim — it names what about the document broke. */
  readonly reason: string;
}

/**
 * Where the instance's one Reindex job stands. `idle` is the state before any run this process
 * has seen; `succeeded` means the walk finished, even if it skipped documents (see
 * {@link ReindexJob.failures}). `failed` is reserved for a walk that *aborted* — a database
 * error, never a bad document.
 */
export type ReindexStatus = 'idle' | 'running' | 'succeeded' | 'failed';

/**
 * The instance's Reindex job (ADR-0046) — the Superadmin repair action that recomputes every
 * Entity's document-derived state. `POST /superadmin/reindex` starts it and returns this
 * immediately; `GET /superadmin/reindex` polls it. There is only ever one: the walk is
 * instance-wide, so a second concurrent run would contend with the first and discover nothing.
 *
 * `walked` counts Entities read, not Entities changed: the write is a wholesale replace with
 * nothing to diff against, and a re-run reporting the same numbers is the reassurance that it is
 * safe to press twice. `reindexed + failures.length === walked`.
 *
 * Job state lives in the API process, not the database, so a restart forgets it. That is sound
 * because the *work* is committed chunk by chunk and the walk is idempotent: whatever a lost job
 * finished stays finished, and pressing the button again resumes the repair from a clean slate.
 */
export interface ReindexJob {
  readonly status: ReindexStatus;
  /** Entities in the instance when the walk started — the denominator for progress. */
  readonly total: number;
  readonly walked: number;
  readonly reindexed: number;
  readonly failures: readonly ReindexFailure[];
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
  /** Set only when `status === 'failed'`: why the walk aborted. */
  readonly error: string | null;
}
