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
