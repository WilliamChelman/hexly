/**
 * User-management and Reindex contracts shared by the API and the web panel. The
 * `/users` surface manages accounts, so — unlike the public `UserSummary`
 * directory — it *does* carry the email: it is the login identity being
 * administered. The Reindex contracts serve the Superadmin `/admin` surface.
 */

import { z } from 'zod';
import { InstanceRole, instanceRolesSchema, MIN_PASSWORD_LENGTH } from './auth';

/**
 * One account row in the user-management panel (`GET /users`). Carries the roles
 * set and the disabled state the panel renders, plus the email (a management
 * concern), but never the password hash.
 */
export interface UserAccount {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  /** The Instance Roles this account holds. */
  readonly roles: readonly InstanceRole[];
  readonly isSuperadmin: boolean;
  /** Epoch ms the account was disabled, or null when active. */
  readonly disabledAt: number | null;
}

/**
 * The stable, structured reasons the user-management surface refuses a mutation.
 * Returned as `{ code }` in the 4xx body — never prose — so the web maps a code
 * to localized copy rather than string-matching English. The HTTP status still
 * carries the category (409 invariant conflict, 403 tier, 404 unknown).
 */
export const UsersErrorCode = {
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
  /** You cannot remove your own `manage-users` role. */
  SelfManageUsersRevoke: 'self-manage-users-revoke',
  /** Only a Superadmin may manage a Superadmin account. */
  SuperadminManaged: 'superadmin-managed-by-superadmin',
  /** No such account. */
  UserNotFound: 'user-not-found',
} as const;

/** One of the {@link UsersErrorCode} values — the wire code in a user-management error body. */
export type UsersErrorCode = (typeof UsersErrorCode)[keyof typeof UsersErrorCode];

/** The structured body of a user-management 4xx: a stable code, plus optional data. */
export interface UsersError {
  readonly code: UsersErrorCode;
  readonly data?: Record<string, unknown>;
}

/** The stable reasons the Superadmin `/admin` (Reindex) surface refuses a mutation. */
export const ReindexErrorCode = {
  /** A Reindex is already walking the instance — there is only ever one. */
  ReindexRunning: 'reindex-running',
} as const;

/** One of the {@link ReindexErrorCode} values. */
export type ReindexErrorCode = (typeof ReindexErrorCode)[keyof typeof ReindexErrorCode];

/** The body of `POST /users` — provision a new account in the closed set. */
export const createUserRequestSchema = z
  .object({
    email: z.string().trim().min(1),
    password: z.string().min(MIN_PASSWORD_LENGTH),
    displayName: z.string().trim().min(1),
  })
  .strict();

/** A validated new-user request. */
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

/** The body of `POST /users/:id/password` — a management-driven reset (no old password). */
export const resetPasswordRequestSchema = z
  .object({
    password: z.string().min(MIN_PASSWORD_LENGTH),
  })
  .strict();

/** A validated management password reset. */
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/**
 * The body of `PATCH /users/:id/roles` — replace the account's whole Instance-Role
 * set (grant/revoke `manage-users` and `create-worlds` in one write). Superadmin
 * is not a member and is toggled by its own endpoint.
 */
export const setUserRolesRequestSchema = z.object({ roles: instanceRolesSchema }).strict();

/** A validated roles-set replacement. */
export type SetUserRolesRequest = z.infer<typeof setUserRolesRequestSchema>;

/** The body of `PATCH /users/:id/disabled` — disable (or re-enable) the account. */
export const setDisabledRequestSchema = z.object({ disabled: z.boolean() }).strict();

/** A validated disabled-state toggle. */
export type SetDisabledRequest = z.infer<typeof setDisabledRequestSchema>;

/** The body of `PATCH /users/:id/superadmin` — set (or clear) the Superadmin flag. */
export const setSuperadminRequestSchema = z.object({ isSuperadmin: z.boolean() }).strict();

/** A validated Superadmin-flag toggle. */
export type SetSuperadminRequest = z.infer<typeof setSuperadminRequestSchema>;

/**
 * One Entity the Reindex walked but could not derive — a document this build cannot parse. The
 * walk skips it and carries on, returning its id so the Superadmin can inspect it by hand.
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
 * The instance's Reindex job (ADR-0046) — the Superadmin repair that recomputes every Entity's
 * document-derived state. `POST /admin/reindex` starts it and returns immediately;
 * `GET /admin/reindex` polls. Only ever one: the walk is instance-wide.
 *
 * `walked` counts Entities read, not changed (the write is a wholesale replace);
 * `reindexed + failures.length === walked`. Job state lives in the API process, not the DB, so a
 * restart forgets it — safe because work commits chunk by chunk and the walk is idempotent.
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
