/**
 * Auth contracts shared by the API and the web client (ADR-0001). The closed
 * user set logs in with email + password; the session itself rides in an
 * HttpOnly cookie, so it never appears in these payloads (ADR-0004).
 */

import { z } from 'zod';

/**
 * A user's roaming Preferences (ADR-0038): the JSON bag stored on the user row
 * and carried on the auth payload. Every field is optional — an absent field
 * means "no expressed choice", and the client falls back to its own detection
 * (browser language, OS theme, Format Locale following the UI Locale). New
 * prefs are a code-only change here; the storage is one JSON column.
 */
/**
 * The Format Locale choices as BCP-47 tags (ADR-0038). `Intl` can't enumerate
 * locales, so the list stays curated. Shared here — not just in the web picker —
 * so the server validates against the exact set the picker offers: a stored tag
 * the picker can't represent is rejected, never silently kept. The web side adds
 * the `''` "Same as language" sentinel and derives every label from
 * `Intl.DisplayNames`, so growing this is one entry with no copy to translate.
 */
export const FORMAT_LOCALE_TAGS = [
  'en-US', 'en-GB', 'en-IE', 'en-CA', 'en-AU', 'en-NZ', 'en-IN',
  'fr-FR', 'fr-CA', 'fr-BE', 'fr-CH', 'de-DE', 'de-AT', 'de-CH',
  'es-ES', 'es-MX', 'it-IT', 'nl-NL', 'nl-BE', 'pt-PT', 'pt-BR',
  'sv-SE', 'da-DK', 'nb-NO', 'fi-FI', 'pl-PL', 'ja-JP',
] as const;

const localeField = z.enum(['en', 'fr']);
const formatLocaleField = z.enum(FORMAT_LOCALE_TAGS);
const themeField = z.enum(['light', 'dark']);

// Read path is lenient (`.strip()`): an unknown key — a hand-edited row, or a
// bag written by a newer deploy that added a pref — drops that key instead of
// failing the whole parse and resetting the user's other prefs to defaults. The
// PATCH boundary below stays `.strict()`, so requests can't smuggle junk in.
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

/** The current user as surfaced by login and `GET /auth/me`. Never the hash. */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly preferences: Preferences;
}

/**
 * A single Instance user in the directory `GET /users` (#158): just enough for
 * the owner-set UI to name an owner and pick a co-Owner. Deliberately omits the
 * email — that is private (ADR-0004), so it never enters the directory.
 */
export interface UserSummary {
  readonly id: string;
  readonly displayName: string;
}

/**
 * The body of `PATCH /auth/me/profile` (ADR-0038): the self-editable identity
 * fields — the display name only. Email is deliberately absent: it is the
 * login identity and stays read-only (an Instance Admin concern).
 */
export const updateProfileRequestSchema = z
  .object({
    displayName: z.string().trim().min(1),
  })
  .strict();

/** A validated profile update. */
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/** The shortest password `POST /auth/me/password` accepts (ADR-0038). */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * The body of `POST /auth/me/password` (ADR-0038): the current password is
 * re-verified against the stored hash before the new one is accepted, so a
 * hijacked session cannot silently take over the account.
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
 * The body of `POST /auth/login`. Both fields must be present and non-empty;
 * the email is otherwise unconstrained — a malformed address simply matches no
 * user rather than being a distinct error (ADR-0004 — credentials are opaque).
 */
export const loginRequestSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

/** A validated login submission. */
export type LoginRequest = z.infer<typeof loginRequestSchema>;
