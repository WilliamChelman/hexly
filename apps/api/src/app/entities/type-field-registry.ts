import { Inject, Injectable } from '@nestjs/common';
import {
  AvailableType,
  EntityType,
  Field,
  FieldResolver,
  FieldSchema,
  fieldSchemaSchema,
  StructuredDataTypeSet,
  TypeFieldRefsResolver,
  TypeFieldResolver,
  unresolvedDataTypeErrors,
} from '@hexly/domain';
import { HEXLY_CONFIG, HexlyConfig } from '../config';
import {
  BUNDLED_STRUCTURED_DATA_TYPES,
  defaultEntityType,
  enabledPluginFields,
  enabledPluginTypes,
  enabledStructuredDataTypes,
} from './bundled-plugins';

/** A registered instance-wide type: its Field schema, the default Field ids it references, and an optional label. */
interface RegisteredType {
  readonly fields: readonly FieldSchema[];
  readonly fieldRefs?: readonly string[];
  readonly label?: string;
}

/**
 * The API-side registry of every code-registered Entity Type — its Field schema and label (ADR-0048).
 * Seeded at startup from the enabled bundled plugins; the domain declares no Entity Type of its own now,
 * so even `core.note` arrives as a bundled plugin type (ADR-0051). A disabled Plugin is filtered from the
 * seed and {@link structuredDataTypes} alike (ADR-0052).
 *
 * An unregistered type resolves to `undefined` ("no Fields", never a throw). A World's user-defined
 * types are not here — they are stored per-World and merged in by {@link WorldTypeFields}.
 */
@Injectable()
export class TypeFieldRegistry {
  private readonly byType = new Map<string, RegisteredType>();

  /** Every code-registered **Plugin Field** by `id` (ADR-0054) — what `fields[]` and `fieldRefs` resolve against. */
  private readonly fieldsById = new Map<string, Field>();

  /**
   * The enabled **Structured Data Types** (ADR-0050, ADR-0052) — instance-wide and code-known, so
   * a World never contributes one. A disabled Plugin's data-type is unknown here, leaving its **Fields
   * of a Structured Data Type** as opaque **Entity Document** values.
   */
  readonly structuredDataTypes: StructuredDataTypeSet;

  /** The "bare Note" default Entity Type (ADR-0051); `undefined` when content is disabled (ADR-0052). */
  readonly defaultType: EntityType | undefined;

  constructor(@Inject(HEXLY_CONFIG) config: HexlyConfig) {
    this.structuredDataTypes = enabledStructuredDataTypes(config);
    this.defaultType = defaultEntityType(config);
    for (const field of enabledPluginFields(config)) this.fieldsById.set(field.id, field);
    for (const type of enabledPluginTypes(config)) this.register(type.id, type.fields, type.label, type.fieldRefs);
  }

  /**
   * Register (or replace) a plugin type's Field schema, its default Field ids (`fieldRefs`, ADR-0054),
   * and an optional `label`. A malformed Field — or a **Field of a Structured Data Type** naming a
   * data-type this build does not bundle — throws rather than degrading. The guard is the full bundled
   * set, not the enabled one (ADR-0052): a Type may name a disabled Plugin's data-type (`core.hexmap`'s
   * `content` Field when content is off), which degrades to an opaque value at derive/vault time via
   * {@link structuredDataTypes}, not a boot failure. Returns an unregister fn.
   */
  register(typeId: string, fields: readonly FieldSchema[], label?: string, fieldRefs?: readonly string[]): () => void {
    const parsed = fields.map((field) => fieldSchemaSchema.parse(field));
    const unresolved = unresolvedDataTypeErrors(parsed, BUNDLED_STRUCTURED_DATA_TYPES);
    if (unresolved.length > 0)
      throw new Error(
        `Type ${typeId} declares Fields with unregistered structured data-types: ${unresolved
          .map((error) => error.key)
          .join(', ')}`,
      );
    this.byType.set(typeId, { fields: parsed, fieldRefs, label });
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
   * The {@link TypeFieldResolver} the domain `resolveFields` unions a `types[]` set through —
   * a single type's declared Fields, or `undefined` for an unregistered type.
   */
  readonly resolver: TypeFieldResolver = (typeId) => this.byType.get(typeId)?.fields;

  /**
   * The instance-wide {@link FieldResolver} (ADR-0054): a **Plugin Field** id → its definition,
   * `undefined` for an unregistered id (a disabled/absent plugin's Field), which the effective-set
   * resolver drops.
   */
  readonly fieldResolver: FieldResolver = (id) => this.fieldsById.get(id);

  /** A plugin type's default Field ids (`fieldRefs`, ADR-0054), so the reuse handles drive derivation, not the inline schema. */
  readonly typeFieldRefs: TypeFieldRefsResolver = (typeId) => this.byType.get(typeId)?.fieldRefs;

  /** Every registered plugin type as an {@link AvailableType} — label defaults to the id; `fieldRefs` omitted when none. */
  plugins(): AvailableType[] {
    return [...this.byType.entries()].map(([id, { fields, fieldRefs, label }]) => ({
      id,
      label: label ?? id,
      source: 'plugin',
      fields,
      ...(fieldRefs?.length ? { fieldRefs } : {}),
    }));
  }
}
