import { join } from 'node:path';

/**
 * Where the shared, logged-in storage state lives: `auth.setup.ts` writes the session cookie here
 * once, the `chromium` project loads it (ADR-0009). Its own module so the Playwright config and
 * the setup spec can share the path without a circular import.
 *
 * `__dirname` (not `import.meta`) because Playwright loads config/specs as CommonJS.
 */
export const authFile = join(__dirname, '..', '.auth', 'user.json');
