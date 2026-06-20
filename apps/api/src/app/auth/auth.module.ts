import { Module } from '@nestjs/common';
import { DB, createDb } from '../db/db';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      // One shared SQLite connection for the process (ADR-0002). Tests override
      // this provider with an in-memory database.
      provide: DB,
      useFactory: () => createDb(process.env.HEXLY_DB_PATH ?? 'hexly.db'),
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
