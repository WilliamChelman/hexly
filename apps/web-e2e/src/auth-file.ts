import { join } from 'node:path';

/**
 * Where a logged-in storage state lives: `auth.setup.ts` writes the session cookie here once, the
 * matching authenticated project loads it (ADR-0009). Its own module so the Playwright config and
 * the setup spec share the path without a circular import.
 *
 * Keyed by server port because a session is a row in *that* server's throwaway DB (ADR-0052, #221):
 * a per-config run boots its own server on its own port, so its session cookie only validates there.
 *
 * `__dirname` (not `import.meta`) because Playwright loads config/specs as CommonJS.
 */
export function authFileFor(port: string): string {
  return join(__dirname, '..', '.auth', `user-${port}.json`);
}
