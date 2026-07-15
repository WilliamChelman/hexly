import { Inject, Injectable } from '@nestjs/common';
import {
  AvailableType,
  EntityType,
  FieldSchema,
  fieldSchemaSchema,
  StructuredDataTypeSet,
  TypeFieldResolver,
  unresolvedDataTypeErrors,
} from '@hexly/domain';
import { HEXLY_CONFIG } from '../config/config.module';
import { HexlyConfig } from '../config/config';
import {
  BUNDLED_STRUCTURED_DATA_TYPES,
  defaultEntityType,
  enabledPluginTypes,
  enabledStructuredDataTypes,
} from './bundled-plugins';

/** A registered instance-wide type: its Field schema plus an optional display label. */
interface RegisteredType {
  readonly fields: readonly FieldSchema[];
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

  /**
   * The enabled **Structured Field** data-types (ADR-0050, ADR-0052) — instance-wide and code-known, so
   * a World never contributes one. A disabled Plugin's data-type is unknown here, leaving its **Structured
   * Fields** as opaque **Entity Document** values.
   */
  readonly structuredDataTypes: StructuredDataTypeSet;

  /** The "bare Note" default Entity Type (ADR-0051); `undefined` when content is disabled (ADR-0052). */
  readonly defaultType: EntityType | undefined;

  constructor(@Inject(HEXLY_CONFIG) config: HexlyConfig) {
    this.structuredDataTypes = enabledStructuredDataTypes(config);
    this.defaultType = defaultEntityType(config);
    for (const type of enabledPluginTypes(config)) this.register(type.id, type.fields, type.label);
  }

  /**
   * Register (or replace) a plugin type's Field schema and optional `label`. A malformed Field — or a
   * **Structured Field** naming a data-type this build does not bundle — throws rather than degrading.
   * The guard is the full bundled set, not the enabled one (ADR-0052): a Type may name a disabled
   * Plugin's data-type (`core.hexmap`'s `content` Field when content is off), which degrades to an opaque
   * value at derive/vault time via {@link structuredDataTypes}, not a boot failure. Returns an unregister fn.
   */
  register(typeId: string, fields: readonly FieldSchema[], label?: string): () => void {
    const parsed = fields.map((field) => fieldSchemaSchema.parse(field));
    const unresolved = unresolvedDataTypeErrors(parsed, BUNDLED_STRUCTURED_DATA_TYPES);
    if (unresolved.length > 0)
      throw new Error(
        `Type ${typeId} declares Fields with unregistered structured data-types: ${unresolved
          .map((error) => error.key)
          .join(', ')}`,
      );
    this.byType.set(typeId, { fields: parsed, label });
    return () => this.byType.delete(typeId);
  }

  /**
   * The {@link TypeFieldResolver} the domain `resolveFields` unions a `types[]` set through —
   * a single type's declared Fields, or `undefined` for an unregistered type.
   */
  readonly resolver: TypeFieldResolver = (typeId) => this.byType.get(typeId)?.fields;

  /** Every registered plugin type as an {@link AvailableType} — label defaults to the id. */
  plugins(): AvailableType[] {
    return [...this.byType.entries()].map(([id, { fields, label }]) => ({
      id,
      label: label ?? id,
      source: 'plugin',
      fields,
    }));
  }
}
