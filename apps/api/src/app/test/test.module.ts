import { Module } from '@nestjs/common';
import { TestController } from './test.controller';

/**
 * E2E-only module bundling the test-support endpoints. Imported by
 * {@link AppModule} only under the e2e opt-in (ADR-0009); never in production.
 * The DB handle it needs comes from the global {@link DbModule}.
 */
@Module({ controllers: [TestController] })
export class TestModule {}
