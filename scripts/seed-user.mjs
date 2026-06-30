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
 *   pnpm seed <email> <password> [--admin]
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { ensureTrailbase } from './trailbase.mjs';

const args = process.argv.slice(2);
const admin = args.includes('--admin');
const [email, password] = args.filter(a => !a.startsWith('-'));
if (!email || !password) {
  console.error('Usage: pnpm seed <email> <password> [--admin]');
  process.exit(1);
}

const trail = ensureTrailbase();
for (const cmd of [
  ['user', 'add', email, password],
  ['user', 'change-password', email, password],
]) {
  const res = spawnSync(trail, cmd, { stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

if (admin) {
  execFileSync('sqlite3', [
    'traildepot/data/main.db',
    `UPDATE _user SET admin = 1 WHERE email = '${email}';`,
  ], { stdio: 'inherit' });
}

console.error(`[seed] Provisioned ${email}${admin ? ' (admin)' : ''}. Admin UI: http://localhost:4000/_/admin/`);
