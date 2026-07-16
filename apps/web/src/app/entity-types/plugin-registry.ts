import { inject, Injectable } from '@angular/core';
import { Field, FieldResolver, structuredDataTypeSet } from '@hexly/domain';
import { ClientConfigStore } from '@hexly/web-core';
import {
  PLUGIN_DATA_TYPES,
  PLUGIN_FIELD_OWNERS,
  PLUGIN_FIELDS,
  PLUGIN_TYPE_OWNERS,
  PLUGIN_VIEW_OWNERS,
  ViewId,
} from '@hexly/web-entity';

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
  private readonly fieldOwners = new Map<string, string>(inject(PLUGIN_FIELD_OWNERS, { optional: true }) ?? []);

  /** The Structured Data Types this build carries, one resolved set threaded into the domain (ADR-0050). */
  readonly structuredDataTypes = structuredDataTypeSet(inject(PLUGIN_DATA_TYPES, { optional: true }) ?? []);

  /** Every composed **Plugin Field** in registration order, for the attach picker (ADR-0054). */
  readonly fields: readonly Field[] = inject(PLUGIN_FIELDS, { optional: true }) ?? [];

  /** Every composed **Plugin Field** by `id`, what `fieldRefs` and an Entity's attached `fields[]` resolve against. */
  private readonly fieldsById = new Map(this.fields.map((field) => [field.id, field] as const));

  /**
   * The instance-wide {@link FieldResolver} (ADR-0054): a Plugin Field id → its definition, `undefined`
   * for an unregistered id **or a disabled Plugin's Field** — so a Field an Entity attaches directly
   * degrades to a plain document value when its Plugin is off, exactly as a Field reached through a
   * disabled Type does (ADR-0052).
   */
  readonly fieldResolver: FieldResolver = (id) => (this.isFieldActive(id) ? this.fieldsById.get(id) : undefined);

  /**
   * The Field definition for `id` **regardless of Plugin enablement** — for clearing a detached Field's
   * value even when its Plugin is disabled (the degraded case the effective set drops). A Field the
   * build never bundled still resolves to `undefined`, its orphaned value irreducibly unclearable.
   */
  fieldDefinition(id: string): Field | undefined {
    return this.fieldsById.get(id);
  }

  /** Whether the Plugin owning Field `id` is enabled; a Field with no owner (a World's user-defined one) is always active. */
  isFieldActive(id: string): boolean {
    return this.isActive(this.fieldOwners.get(id));
  }

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
