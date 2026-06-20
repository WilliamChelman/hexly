import { join } from 'node:path';

/**
 * Where the shared, logged-in storage state lives. `auth.setup.ts` writes the
 * session cookie here once; the `chromium` project loads it so the authenticated
 * suite starts signed in (ADR-0009). Kept in its own module so both the Playwright
 * config and the setup spec import the same path without a circular dependency.
 *
 * `__dirname` (not `import.meta`) because Playwright loads config/specs as
 * CommonJS.
 */
export const authFile = join(__dirname, '..', '.auth', 'user.json');
