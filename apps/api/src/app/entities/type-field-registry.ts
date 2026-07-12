import { Injectable } from '@nestjs/common';
import { AvailableType, CORE_TYPES, FieldSchema, fieldSchemaSchema, TypeFieldResolver } from '@hexly/domain';
import { BUNDLED_PLUGIN_TYPES } from './bundled-plugins';

/** A registered instance-wide type: its Field schema plus an optional display label. */
interface RegisteredType {
  readonly fields: readonly FieldSchema[];
  readonly label?: string;
}

/**
 * The API-side registry of every code-registered Entity Type — its Field schema and label (ADR-0048),
 * the backend twin of the web `TypeRegistry`. Seeded at startup from the core types and the bundled
 * plugins in one loop, since both are `defineType` declarations. The write path resolves a plugin's
 * Fields from here for the forward-only gate and the facet build, knowing nothing of its Angular view.
 *
 * The core types declare no Fields, so they add nothing to resolve; they are registered so a World's
 * available-types list reports the whole code-registered set. An unregistered type resolves to
 * `undefined` ("no Fields", never a throw).
 *
 * A World's user-defined types are not here — they are stored per-World and merged in by
 * {@link WorldTypeFields}.
 */
@Injectable()
export class TypeFieldRegistry {
  private readonly byType = new Map<string, RegisteredType>();

  constructor() {
    for (const type of [...CORE_TYPES, ...BUNDLED_PLUGIN_TYPES]) this.register(type.id, type.fields, type.label);
  }

  /**
   * Register (or replace) a plugin type's Field schema and optional `label`, validating each Field
   * through the shared Zod so a malformed plugin fails loudly at startup. Returns an unregister fn.
   */
  register(typeId: string, fields: readonly FieldSchema[], label?: string): () => void {
    this.byType.set(typeId, {
      fields: fields.map((field) => fieldSchemaSchema.parse(field)),
      label,
    });
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
