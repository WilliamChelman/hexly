/**
 * Auth contracts shared by the API and the web client. The session itself rides
 * in an HttpOnly cookie, so it never appears in these payloads.
 */

import { z } from 'zod';

/**
 * The Format Locale choices as BCP-47 tags. `Intl` can't enumerate locales, so
 * the list stays curated. Shared so the server validates against the exact set
 * the web picker offers.
 */
export const FORMAT_LOCALE_TAGS = [
  'en-US',
  'en-GB',
  'en-IE',
  'en-CA',
  'en-AU',
  'en-NZ',
  'en-IN',
  'fr-FR',
  'fr-CA',
  'fr-BE',
  'fr-CH',
  'de-DE',
  'de-AT',
  'de-CH',
  'es-ES',
  'es-MX',
  'it-IT',
  'nl-NL',
  'nl-BE',
  'pt-PT',
  'pt-BR',
  'sv-SE',
  'da-DK',
  'nb-NO',
  'fi-FI',
  'pl-PL',
  'ja-JP',
] as const;

const localeField = z.enum(['en', 'fr']);
const formatLocaleField = z.enum(FORMAT_LOCALE_TAGS);
const themeField = z.enum(['light', 'dark']);

// The roaming Preferences bag stored on the user row; an absent field means "no
// expressed choice" and the client falls back to its own detection. Read path is
// lenient (`.strip()`): an unknown key drops instead of failing the whole parse
// and resetting the other prefs. The PATCH boundary below stays `.strict()`.
export const preferencesSchema = z
  .object({
    /** UI language (the Locale). */
    locale: localeField.optional(),
    /** Regional formatting (a BCP-47 tag), independent of the UI language. */
    formatLocale: formatLocaleField.optional(),
    theme: themeField.optional(),
  })
  .strip();

/** A user's validated Preferences bag. */
export type Preferences = z.infer<typeof preferencesSchema>;

/**
 * The body of `PATCH /auth/me/preferences`: the bag with every field also
 * accepting an explicit `null`, meaning "clear this pref back to no choice"
 * (e.g. Format Locale returning to "Same as language"). Absent fields keep
 * their stored value; the stored bag itself never holds nulls.
 */
export const preferencesPatchSchema = z
  .object({
    locale: localeField.nullish(),
    formatLocale: formatLocaleField.nullish(),
    theme: themeField.nullish(),
  })
  .strict();

/** A validated Preferences patch (`null` = clear). */
export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;

/**
 * The closed, code-known set of Instance Roles — account-wide powers a user may
 * hold on their account (ADR-0047). Orthogonal: holding one implies nothing
 * about the other. `manage-users` was the old `is_admin` flag; `create-worlds`
 * the old `can_create_worlds`. Superadmin is not a member — it is a separate
 * flag that supersedes the whole set.
 */
export const INSTANCE_ROLES = ['manage-users', 'create-worlds'] as const;

/** One Instance Role. */
export type InstanceRole = (typeof INSTANCE_ROLES)[number];

/** The stored `roles` set on a user account: a subset of the Instance Roles. */
export const instanceRolesSchema = z.array(z.enum(INSTANCE_ROLES));

/** The two fields any Instance-Role check reads: the held roles plus the Superadmin flag. */
export interface InstanceRoleHolder {
  readonly roles: readonly InstanceRole[];
  readonly isSuperadmin: boolean;
}

/**
 * Holds the `manage-users` role, or is a Superadmin (who supersedes every role).
 * The single home of the `Superadmin ⊇ everything` implication for account
 * management — call it rather than checking the array inline, so the rule can't
 * drift.
 */
export function canManageUsers(user: InstanceRoleHolder): boolean {
  return user.isSuperadmin || user.roles.includes('manage-users');
}

/** Holds the `create-worlds` role, or is a Superadmin. */
export function canCreateWorlds(user: InstanceRoleHolder): boolean {
  return user.isSuperadmin || user.roles.includes('create-worlds');
}

/** The current user as surfaced by login and `GET /auth/me`. Never the hash. */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly preferences: Preferences;
  /** The Instance Roles this user holds — account-wide powers (ADR-0047). */
  readonly roles: readonly InstanceRole[];
  /** Superadmin: the operator's in-app self. Supersedes every Instance Role. */
  readonly isSuperadmin: boolean;
}

/**
 * A single Instance user in the directory `GET /users`. Deliberately omits the
 * email — that is private, so it never enters the directory.
 */
export interface UserSummary {
  readonly id: string;
  readonly displayName: string;
}

/**
 * The body of `PATCH /auth/me/profile` — the display name only. Email is
 * deliberately absent: it is the login identity and stays read-only.
 */
export const updateProfileRequestSchema = z
  .object({
    displayName: z.string().trim().min(1),
  })
  .strict();

/** A validated profile update. */
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/** The shortest password `POST /auth/me/password` accepts. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * The body of `POST /auth/me/password`: the current password is re-verified
 * against the stored hash first, so a hijacked session cannot silently take
 * over the account.
 */
export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(MIN_PASSWORD_LENGTH),
  })
  .strict();

/** A validated password change. */
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/**
 * The body of `POST /auth/login`. The email is otherwise unconstrained — a
 * malformed address simply matches no user rather than being a distinct error.
 */
export const loginRequestSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

/** A validated login submission. */
export type LoginRequest = z.infer<typeof loginRequestSchema>;
