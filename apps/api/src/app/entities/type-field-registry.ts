import { Injectable } from '@nestjs/common';
import { AvailableType, FieldSchema, fieldSchemaSchema, TypeFieldResolver } from '@hexly/domain';

/** A registered instance-wide type: its Field schema plus an optional display label. */
interface RegisteredType {
  readonly fields: readonly FieldSchema[];
  readonly label?: string;
}

/**
 * The API-side registry of each instance-wide **plugin** Entity Type — its **Field schema** and
 * label (ADR-0048) — the backend twin of the web `TypeRegistry`. A bundled plugin registers its
 * type here at startup the same way it registers its view on the web, so the forward-only write-path
 * gate ({@link EntitiesService.save}) can resolve a `types[]` set to the Fields an active typed edit
 * must satisfy, and the per-World available-types read can list plugin types alongside a World's
 * user-defined ones.
 *
 * Core `note`/`hexmap` declare no Fields, so the registry starts empty and a core type resolves to
 * nothing — the gate is a no-op until a plugin contributes a schema. `undefined` for an unregistered
 * type, which {@link resolveFields} reads as "no Fields", never a throw. A World's user-defined types
 * are *not* here — they are stored per-World and merged in by {@link WorldTypeFields}.
 */
@Injectable()
export class TypeFieldRegistry {
  private readonly byType = new Map<string, RegisteredType>();

  /**
   * Register (or replace) a plugin type's Field schema and optional `label`, validating each Field
   * declaration through the shared Zod schema so a malformed plugin schema fails loudly at startup,
   * not silently at edit time. Returns an unregister fn, mirroring the web registry.
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

  /**
   * Every registered plugin type as an {@link AvailableType} (`source: 'plugin'`) — the instance-wide
   * half of a World's available-types read. Label defaults to the type id when none was registered.
   */
  plugins(): AvailableType[] {
    return [...this.byType.entries()].map(([id, { fields, label }]) => ({
      id,
      label: label ?? id,
      source: 'plugin',
      fields,
    }));
  }
}
