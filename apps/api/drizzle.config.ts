import { defineConfig } from 'drizzle-kit';

// `schema.ts` is the single source of truth (ADR-0027). `generate` diffs it
// against the snapshot in `out/` and emits the next versioned SQL migration —
// it never touches a live database, so no `dbCredentials` is needed here.
// Migrations are applied at boot by `createDb`, not by the drizzle-kit CLI.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/app/db/schema.ts',
  out: './src/app/db/migrations',
});
