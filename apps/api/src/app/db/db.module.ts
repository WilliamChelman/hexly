import {
  Global,
  Inject,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DB, Db, createDb, resolveDbPath } from './db';

/**
 * Owns the one shared SQLite connection for the process (ADR-0002). Marked
 * `@Global()` so any module — and the standalone seed context — can inject the
 * {@link DB} token without re-importing this module.
 *
 * The connection is opened once via {@link createDb} against the path
 * {@link resolveDbPath} computes, and closed on application shutdown so the
 * better-sqlite3 handle (and its WAL files) is released cleanly.
 *
 * Tests override the {@link DB} provider with an in-memory database; that
 * override still targets this provider because AuthModule imports DbModule, so
 * the token resolves through AuthModule's import graph.
 */
@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: () => createDb(resolveDbPath()),
    },
  ],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  onApplicationShutdown(): void {
    // Release the underlying better-sqlite3 handle. `$client` is the raw
    // Database; in-memory test databases close harmlessly too.
    this.db.$client.close();
  }
}
