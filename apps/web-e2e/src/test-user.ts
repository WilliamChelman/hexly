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
