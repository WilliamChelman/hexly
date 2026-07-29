import { Inject, Injectable } from '@nestjs/common';
import { compendiumDeclarationSchema, Importer, importerIdSchema } from '@hexly/domain';
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
    for (const importer of enabledPluginImporters(config)) this.register(importer);
  }

  /** Register (or replace) an Importer, for a test-injected stub or a late contribution. Returns an unregister fn. */
  register(importer: Importer): () => void {
    importerIdSchema.parse(importer.id);
    // A Compendium Importer's declaration is parsed here too, so a pack that names no Compendium name —
    // the Container's, and the only handle a reader ever sees it by — fails at startup, not mid-run.
    if (importer.compendium) compendiumDeclarationSchema.parse(importer.compendium);
    this.byId.set(importer.id, importer);
    return () => this.byId.delete(importer.id);
  }

  /** The Importer with this `namespace.id`, or `undefined` when none is registered (a 404 at the surface). */
  get(id: string): Importer | undefined {
    return this.byId.get(id);
  }

  /**
   * Every registered Importer, in registration order. Returned whole rather than pre-filtered: what
   * splits them is the {@link Importer.compendium} declaration each carries, and the two surfaces that
   * read this — the World's Imports panel and the operator's pack panel — each keep their own half of
   * that rule (ADR-0079).
   */
  all(): readonly Importer[] {
    return [...this.byId.values()];
  }
}
