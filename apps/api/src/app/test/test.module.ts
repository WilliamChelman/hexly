import { Module } from '@nestjs/common';
import { WorldsModule } from '../worlds/worlds.module';
import { E2eFixtureImporters } from './e2e-fixture-importers';
import { TestController } from './test.controller';

/**
 * E2E-only module bundling the test-support endpoints. Imported by {@link AppModule} only under
 * the e2e opt-in (ADR-0009); never in production. Imports {@link WorldsModule} for its shared
 * {@link ImporterRegistry}, which {@link E2eFixtureImporters} re-points at the Draw Steel fixtures.
 */
@Module({ imports: [WorldsModule], controllers: [TestController], providers: [E2eFixtureImporters] })
export class TestModule {}
