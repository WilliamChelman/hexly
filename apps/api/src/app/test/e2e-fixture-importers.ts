import { Injectable, OnModuleInit } from '@nestjs/common';
import { createMonstersImporter, MONSTERS_IMPORTER_ID } from '@hexly/plugin-draw-steel/server';
import { fixtureFetchPort } from '@hexly/plugin-draw-steel/server/testing';
import { ImporterRegistry } from '../worlds/importer-registry';

/**
 * E2E-only: swap the Draw Steel monsters Importer's real codeload fetch port (ADR-0061 — which needs
 * network egress to GitHub) for the committed Ajax + Goblin fixtures, so the Imports-panel e2e drives
 * the whole produce → reconcile pipe offline and deterministically. Registered only under the e2e
 * opt-in (via {@link TestModule}, ADR-0009), and only replaces an already-registered Importer, so an
 * Instance with Draw Steel disabled still exposes none.
 */
@Injectable()
export class E2eFixtureImporters implements OnModuleInit {
  constructor(private readonly registry: ImporterRegistry) {}

  onModuleInit(): void {
    if (this.registry.get(MONSTERS_IMPORTER_ID)) {
      this.registry.register(createMonstersImporter(fixtureFetchPort()));
    }
  }
}
