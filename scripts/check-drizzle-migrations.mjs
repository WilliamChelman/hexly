// Guard that every schema change goes through `drizzle-kit generate` (ADR-0027) — no hand-authored
// migrations. schema.ts is the single source of truth; a hand-written `.sql` (or one whose snapshot
// was skipped) silently breaks the `generate` diff base, so this runs in CI beside the lint/test gate.
//
// Two independent checks:
//   1. `drizzle-kit check` — the journal ↔ snapshot chain is internally consistent (catches a missing
//      or mismatched per-migration snapshot, exactly the hand-authoring slip this exists to stop).
//   2. Drift — regenerate with no TTY; if that leaves the migrations dir dirty, a schema.ts edit never
//      went through `pnpm db:generate` (or a migration was hand-authored), so the diff base is stale.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const apiDir = resolve(repoRoot, 'apps/api');
const migrationsPath = 'apps/api/src/app/db/migrations';

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

// 1. Chain integrity.
try {
  execFileSync('pnpm', ['exec', 'drizzle-kit', 'check'], { cwd: apiDir, stdio: 'inherit' });
} catch {
  fail('`drizzle-kit check` failed — the migration snapshot chain is inconsistent.');
}

// 2. Drift. `input: ''` denies the interactive rename prompt an EOF, so an ambiguous diff errors here
//    (a failure) rather than hanging CI. A clean repo yields "nothing to migrate" and writes nothing.
try {
  execFileSync('pnpm', ['exec', 'drizzle-kit', 'generate'], {
    cwd: apiDir,
    input: '',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
} catch {
  fail('`drizzle-kit generate` could not run non-interactively — resolve the schema diff with `pnpm db:generate`.');
}

const dirty = execFileSync('git', ['status', '--porcelain', '--', migrationsPath], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();
if (dirty) {
  fail(
    `schema.ts and the drizzle migrations are out of sync. Run \`pnpm db:generate\` and commit the\n` +
      `generated migration + snapshot — never hand-author a migration (ADR-0027). Pending changes:\n${dirty}`,
  );
}

console.log('✓ drizzle migrations are in sync with schema.ts');
