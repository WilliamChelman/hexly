// @ts-check
/**
 * Provisions a member of the closed user set (ADR-0004, ADR-0032) into the dev
 * depot (`./traildepot`). There is no public sign-up, so this is how dev logins
 * are created.
 *
 * `trail user add` under the closed-set config (`disable_password_auth: true`)
 * registers the account but a follow-up `change-password` is what stores the
 * usable credential — so we run both.
 *
 *   pnpm seed <email> <password>
 */
import { spawnSync } from 'node:child_process';
import { ensureTrailbase } from './trailbase.mjs';

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: pnpm seed <email> <password>');
  process.exit(1);
}

const trail = ensureTrailbase();
for (const args of [
  ['user', 'add', email, password],
  ['user', 'change-password', email, password],
]) {
  const res = spawnSync(trail, args, { stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status ?? 1);
}
console.error(`[seed] Provisioned ${email}. Admin UI: http://localhost:4000/_/admin/`);
