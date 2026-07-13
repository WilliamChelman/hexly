import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { DB, Db, createDb, resolveDbPath } from './db';

/**
 * Owns the one shared SQLite connection for the process (ADR-0002). Opened once
 * via {@link createDb} against {@link resolveDbPath}, and closed on application
 * shutdown so the better-sqlite3 handle (and its WAL files) is released cleanly.
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
