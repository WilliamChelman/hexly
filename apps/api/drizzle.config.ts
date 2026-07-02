import { defineConfig } from 'drizzle-kit';

// schema.ts is the single source of truth (ADR-0027); generate diffs it
// against the snapshot and emits SQL migrations. Migrations are applied at
// boot by createDb (ADR-0027), not by the drizzle-kit CLI.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/app/db/schema.ts',
  out: './src/app/db/migrations',
});
