/**
 * The single seeded user the e2e suite logs in as. This is the source of truth:
 * `playwright.config.ts` passes these values to `e2e-server.mjs` (which seeds the
 * throwaway DB) via the web-server env, and the specs import them to log in — so
 * the seeded credentials and the typed-in credentials can never drift.
 */
export const TEST_USER = {
  email: 'e2e@hexly.test',
  password: 'hexly-e2e-password',
  displayName: 'E2E Tester',
} as const;
