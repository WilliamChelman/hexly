import { Injectable } from '@nestjs/common';
import { AvailableType, FieldSchema, fieldSchemaSchema, TypeFieldResolver } from '@hexly/domain';

/** A registered instance-wide type: its Field schema plus an optional display label. */
interface RegisteredType {
  readonly fields: readonly FieldSchema[];
  readonly label?: string;
}

/**
 * The API-side registry of each instance-wide plugin Entity Type — its Field schema and label
 * (ADR-0048) — the backend twin of the web `TypeRegistry`. Core `note`/`hexmap` declare no Fields,
 * so it starts empty and an unregistered type resolves to `undefined` ("no Fields", never a throw).
 * A World's user-defined types are not here — they are stored per-World and merged in by
 * {@link WorldTypeFields}.
 */
@Injectable()
export class TypeFieldRegistry {
  private readonly byType = new Map<string, RegisteredType>();

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
