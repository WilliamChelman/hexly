/**
 * The single seeded user the e2e suite logs in as. `playwright.config.ts` passes these
 * values to `e2e-server.mjs` (which seeds the throwaway DB) via the web-server env; the
 * specs import them to log in.
 */
export const TEST_USER = {
  email: 'e2e@hexly.test',
  password: 'hexly-e2e-password',
  displayName: 'E2E Tester',
} as const;

/**
 * A second seeded user the suite never logs in as — it exists only to populate the
 * Instance user directory so entity-grant / ownership specs have someone to share with
 * (ADR-0037). Same wiring as {@link TEST_USER}; the specs pick it by display name.
 */
export const TEST_GRANTEE = {
  email: 'grantee@hexly.test',
  password: 'hexly-e2e-grantee',
  displayName: 'Grantee Gwen',
} as const;

/**
 * The **operator** — a Superadmin the suite signs in as only to reach the admin area (ADR-0047).
 * Compendium packs are stocked there and nowhere else (#404), so a spec that needs an installed pack
 * borrows this standing for the install and goes back to {@link TEST_USER} for everything after it.
 * Deliberately a *third* account: making the login user a Superadmin would quietly hand every other
 * spec a bypass over every access predicate.
 */
export const TEST_OPERATOR = {
  email: 'operator@hexly.test',
  password: 'hexly-e2e-operator',
  displayName: 'Operator Odile',
} as const;
