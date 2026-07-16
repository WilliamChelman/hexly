import { inject, Injectable } from '@angular/core';
import { FieldResolver, structuredDataTypeSet } from '@hexly/domain';
import { ClientConfigStore } from '@hexly/web-core';
import { PLUGIN_DATA_TYPES, PLUGIN_FIELDS, PLUGIN_TYPE_OWNERS, PLUGIN_VIEW_OWNERS, ViewId } from '@hexly/web-entity';

/**
 * The one home for what the bundled plugins contributed and which are enabled (ADR-0052, Seam 3): the
 * resolved **Structured Data Type** set, the Type/View → owning-Plugin maps, and the enablement
 * predicate the {@link TypeRegistry} and {@link ViewRegistry} filter through. It folds the ownership
 * tokens — which only `providePlugin` knows — against {@link ClientConfigStore}, so neither registry
 * reaches into DI for them or repeats the is-active check.
 */
@Injectable({ providedIn: 'root' })
export class PluginRegistry {
  private readonly clientConfig = inject(ClientConfigStore);
  private readonly typeOwners = new Map<string, string>(inject(PLUGIN_TYPE_OWNERS, { optional: true }) ?? []);
  private readonly viewOwners = new Map<ViewId, string>(inject(PLUGIN_VIEW_OWNERS, { optional: true }) ?? []);

  /** The Structured Data Types this build carries, one resolved set threaded into the domain (ADR-0050). */
  readonly structuredDataTypes = structuredDataTypeSet(inject(PLUGIN_DATA_TYPES, { optional: true }) ?? []);

  /** Every composed **Plugin Field** by `id` (ADR-0054), what `fieldRefs` and an Entity's attached `fields[]` resolve against. */
  private readonly fieldsById = new Map(
    (inject(PLUGIN_FIELDS, { optional: true }) ?? []).map((field) => [field.id, field] as const),
  );

  /**
   * The instance-wide {@link FieldResolver} (ADR-0054): a Plugin Field id → its definition, `undefined`
   * for an unregistered id. Composed from the whole build like {@link structuredDataTypes}, not
   * enablement-filtered — a disabled Plugin's Field degrades at the Type and View layers instead (ADR-0052).
   */
  readonly fieldResolver: FieldResolver = (id) => this.fieldsById.get(id);

  /** Whether the Plugin owning Type `id` is enabled; a Type with no owner (a World's user-defined one) is always active. */
  isTypeActive(id: string): boolean {
    return this.isActive(this.typeOwners.get(id));
  }

  /** Whether the Plugin owning View `id` is enabled; an app-owned View (no owner) is always active. */
  isViewActive(id: ViewId): boolean {
    return this.isActive(this.viewOwners.get(id));
  }

  private isActive(owner: string | undefined): boolean {
    return owner == null || this.clientConfig.isPluginEnabled(owner);
  }
}
