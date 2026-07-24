import { Inject, Injectable } from '@nestjs/common';
import {
  AvailableType,
  EntityType,
  Field,
  FieldResolver,
  StructuredDataType,
  StructuredDataTypeSet,
  TypeFieldRefsResolver,
} from '@hexly/domain';
import { HEXLY_CONFIG, HexlyConfig } from '../config';
import {
  defaultEntityType,
  enabledPluginFields,
  enabledPluginTypes,
  enabledStructuredDataTypes,
} from './bundled-plugins';

/** A registered instance-wide type: the default Field ids it references, and an optional label. */
interface RegisteredType {
  readonly fieldRefs: readonly string[];
  readonly label?: string;
  /** The generic hidden-from-default-listing capability (ADR-0065); absent → always listed. */
  readonly hiddenFromDefaultListing?: boolean;
}

/** Optional per-type capability flags a code-registered type may declare (ADR-0065). */
export interface TypeCapabilities {
  readonly hiddenFromDefaultListing?: boolean;
}

/**
 * The API-side registry of every code-registered Entity Type — its default Field ids and label
 * (ADR-0048, ADR-0054). Seeded at startup from the enabled bundled plugins; the domain declares no
 * Entity Type of its own now, so even `core.type.note` arrives as a bundled plugin type (ADR-0051). A
 * disabled Plugin is filtered from the seed and {@link structuredDataTypes} alike (ADR-0052).
 *
 * An unregistered type resolves to `undefined` ("no Fields", never a throw). A World's user-defined
 * types are not here — they are stored per-World and merged in by {@link WorldTypeFields}.
 */
@Injectable()
export class TypeFieldRegistry {
  private readonly byType = new Map<string, RegisteredType>();

  /** Every code-registered **Plugin Field** by `id` (ADR-0054) — what a type's `fieldRefs` resolve against. */
  private readonly fieldsById = new Map<string, Field>();

  /**
   * The enabled **Structured Data Types** (ADR-0050, ADR-0052) — instance-wide and code-known, so
   * a World never contributes one. A disabled Plugin's data-type is unknown here, leaving its **Fields
   * of a Structured Data Type** as opaque **Entity Document** values. Backs the read-only
   * {@link structuredDataTypes} view; a plugin (or a test) may {@link registerStructuredDataType} more.
   */
  private readonly structuredDataTypesById = new Map<string, StructuredDataType>();

  /** The "bare Note" default Entity Type (ADR-0051); `undefined` when content is disabled (ADR-0052). */
  readonly defaultType: EntityType | undefined;

  constructor(@Inject(HEXLY_CONFIG) config: HexlyConfig) {
    for (const [id, dataType] of enabledStructuredDataTypes(config)) this.structuredDataTypesById.set(id, dataType);
    this.defaultType = defaultEntityType(config);
    for (const field of enabledPluginFields(config)) this.fieldsById.set(field.id, field);
    for (const type of enabledPluginTypes(config))
      this.register(type.id, type.fieldRefs, type.label, {
        hiddenFromDefaultListing: type.hiddenFromDefaultListing,
      });
  }

  /**
   * The registered **Structured Data Types** (ADR-0050) keyed by `namespace.id` kind — what the derive,
   * vault, and facet passes resolve a Field's structured kind against.
   */
  get structuredDataTypes(): StructuredDataTypeSet {
    return this.structuredDataTypesById;
  }

  /**
   * Register a code-registered **Structured Data Type** (ADR-0050), for a plugin (or a test) that
   * contributes one outside the boot-time fold. Returns an unregister fn.
   */
  registerStructuredDataType(dataType: StructuredDataType): () => void {
    this.structuredDataTypesById.set(dataType.id, dataType);
    return () => this.structuredDataTypesById.delete(dataType.id);
  }

  /**
   * Register (or replace) a plugin type's default Field ids (`fieldRefs`, ADR-0054) and an optional
   * `label`. A type declares its Fields by id only — one resolution path (id → Field), no inline
   * schema — so the guard that a Field's **Structured Data Type** is bundled moves to Field
   * registration. Returns an unregister fn.
   */
  register(typeId: string, fieldRefs: readonly string[], label?: string, capabilities?: TypeCapabilities): () => void {
    this.byType.set(typeId, { fieldRefs, label, hiddenFromDefaultListing: capabilities?.hiddenFromDefaultListing });
    return () => this.byType.delete(typeId);
  }

  /**
   * Register a code-registered **Plugin Field** by its id (ADR-0054), for a plugin (or a test) that
   * contributes one outside the boot-time fold. Returns an unregister fn.
   */
  registerField(field: Field): () => void {
    this.fieldsById.set(field.id, field);
    return () => this.fieldsById.delete(field.id);
  }

  /**
   * The instance-wide {@link FieldResolver} (ADR-0054): a **Plugin Field** id → its definition,
   * `undefined` for an unregistered id (a disabled/absent plugin's Field), which the effective-set
   * resolver drops.
   */
  readonly fieldResolver: FieldResolver = (id) => this.fieldsById.get(id);

  /** A plugin type's default Field ids (`fieldRefs`, ADR-0054), so the reuse handles drive derivation. */
  readonly typeFieldRefs: TypeFieldRefsResolver = (typeId) => this.byType.get(typeId)?.fieldRefs;

  /**
   * Every code-registered **Plugin Field** (ADR-0054) — the instance-wide half of the World's Field
   * set, enumerated for presence-based Field faceting (#231) where a key is resolved without going
   * through a type's `fieldRefs`.
   */
  fields(): Field[] {
    return [...this.fieldsById.values()];
  }

  /** Every registered plugin type as an {@link AvailableType} — label defaults to the id. */
  plugins(): AvailableType[] {
    return [...this.byType.entries()].map(([id, { fieldRefs, label, hiddenFromDefaultListing }]) => ({
      id,
      label: label ?? id,
      source: 'plugin',
      fieldRefs,
      // Carry the capability through so surfaces honour it generically (ADR-0065); omit when unset.
      ...(hiddenFromDefaultListing ? { hiddenFromDefaultListing: true } : {}),
    }));
  }

  /**
   * The ids of every registered type that sets the hidden-from-default-listing capability (ADR-0065) —
   * the generic set the Entity Browser excludes from its default result set (and every facet count but
   * the type facet), surfacing each only once its type is explicitly selected. Names no type.
   */
  get hiddenDefaultTypes(): readonly string[] {
    return [...this.byType.entries()].filter(([, t]) => t.hiddenFromDefaultListing).map(([id]) => id);
  }
}
