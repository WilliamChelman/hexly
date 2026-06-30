/**
 * The seeded users the e2e suite logs in as. This is the source of truth:
 * `playwright.config.ts` passes them to `e2e-server.mjs` (which seeds the throwaway
 * DB) via the web-server env, and the specs import them to log in — so the seeded
 * credentials and the typed-in credentials can never drift.
 *
 * `TEST_USER` is the default user the UI suite logs in as (and the World Owner in
 * the sharing specs). The rest are the other roles the sharing slice (#131) drives
 * the Record APIs as: a Contributor and a World Viewer (named members), an entity
 * grantee, and an outsider who belongs to nothing.
 */
export const TEST_USER = {
  email: 'e2e@hexly.test',
  password: 'hexly-e2e-password',
  displayName: 'E2E Tester',
} as const;

export const CONTRIBUTOR = {
  email: 'contributor@hexly.test',
  password: 'hexly-e2e-password',
  displayName: 'Contributor',
} as const;

export const VIEWER = {
  email: 'viewer@hexly.test',
  password: 'hexly-e2e-password',
  displayName: 'World Viewer',
} as const;

export const GRANTEE = {
  email: 'grantee@hexly.test',
  password: 'hexly-e2e-password',
  displayName: 'Entity Grantee',
} as const;

export const OUTSIDER = {
  email: 'outsider@hexly.test',
  password: 'hexly-e2e-password',
  displayName: 'Outsider',
} as const;

/** Every seeded user, for the e2e server to provision via `trail user add`. */
export const TEST_USERS = [TEST_USER, CONTRIBUTOR, VIEWER, GRANTEE, OUTSIDER] as const;
