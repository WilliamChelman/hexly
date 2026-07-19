import { Inject, Injectable } from '@nestjs/common';
import { Importer, ImporterSummary } from '@hexly/domain';
import { HEXLY_CONFIG, HexlyConfig } from '../config';
import { enabledPluginImporters } from '../entities/bundled-plugins';

/**
 * The API-side registry of every code-registered {@link Importer} (ADR-0060), seeded at startup from
 * the enabled bundled Plugins — the mirror of {@link TypeFieldRegistry} for the import seam. A disabled
 * Plugin's Importers never enter the seed, so its Imports-panel entry and reconcile path drop with it
 * (ADR-0052). The generic reconcile lists and runs whatever this holds; a plugin (or a test) may
 * {@link register} one outside the boot-time fold.
 */
@Injectable()
export class ImporterRegistry {
  private readonly byId = new Map<string, Importer>();

  constructor(@Inject(HEXLY_CONFIG) config: HexlyConfig) {
    for (const importer of enabledPluginImporters(config)) this.byId.set(importer.id, importer);
  }

  /** Register (or replace) an Importer, for a test-injected stub or a late contribution. Returns an unregister fn. */
  register(importer: Importer): () => void {
    this.byId.set(importer.id, importer);
    return () => this.byId.delete(importer.id);
  }

  /** The Importer with this `namespace.id`, or `undefined` when none is registered (a 404 at the surface). */
  get(id: string): Importer | undefined {
    return this.byId.get(id);
  }

  /** Every registered Importer as an {@link ImporterSummary} — the list surface's payload; label defaults to the id. */
  list(): ImporterSummary[] {
    return [...this.byId.values()].map((importer) => ({ id: importer.id, label: importer.label ?? importer.id }));
  }
}
