/**
 * Structured API error bodies shared by the server and the web. A refused
 * mutation returns `{ code }` — a stable, localizable identifier — never prose,
 * so the web maps a code to its own copy instead of string-matching English.
 * The HTTP status still carries the category. (The Instance Admin surface has
 * its own {@link UsersErrorCode} vocabulary in `./admin`.)
 */
export interface ApiError {
  readonly code: string;
  readonly data?: Record<string, unknown>;
}

/** Which resource an ACL invariant refers to — the `data.kind` on a {@link AclErrorCode}. */
export type AclResourceKind = 'world' | 'entity';

/**
 * The structured reasons an ACL "set" mutation (ownership, membership, grants) refuses.
 * `last-owner` carries `data: { kind }` — a World or an Entity must keep ≥1 Owner.
 */
export const AclErrorCode = {
  /** The target user id isn't an Instance user (400). */
  NoSuchUser: 'no-such-user',
  /** Removing this Owner would empty the set — the ≥1-Owner invariant (409). */
  LastOwner: 'last-owner',
} as const;

/** One of the {@link AclErrorCode} values. */
export type AclErrorCode = (typeof AclErrorCode)[keyof typeof AclErrorCode];

/** The structured reasons an Entity lifecycle mutation refuses. */
export const EntityErrorCode = {
  /** No World the caller may create an Entity in (404). */
  NoWritableWorld: 'no-writable-world',
} as const;

/** One of the {@link EntityErrorCode} values. */
export type EntityErrorCode = (typeof EntityErrorCode)[keyof typeof EntityErrorCode];

/** The structured reasons a vault import refuses its upload. */
export const ImportErrorCode = {
  /** The upload is not a `.zip` archive (400). */
  NotAZip: 'not-a-zip',
  /** The upload claims to be a `.zip` but cannot be read (400). */
  UnreadableZip: 'unreadable-zip',
  /** The decompressed vault exceeds the instance's size ceiling (413). */
  TooLarge: 'vault-too-large',
} as const;

/** One of the {@link ImportErrorCode} values. */
export type ImportErrorCode = (typeof ImportErrorCode)[keyof typeof ImportErrorCode];
