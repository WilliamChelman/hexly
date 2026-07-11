import { Injectable } from '@nestjs/common';
import { FieldSchema, fieldSchemaSchema, TypeFieldResolver } from '@hexly/domain';

/**
 * The API-side registry of each Entity Type's **Field schema** (ADR-0048) — the
 * backend twin of the web `TypeRegistry`. A bundled plugin registers its type's
 * Fields here at startup the same way it registers its view on the web, so the
 * forward-only write-path gate ({@link EntitiesService.save}) can resolve a
 * `types[]` set to the Fields an active typed edit must satisfy.
 *
 * Core `note`/`hexmap` declare no Fields, so the registry starts empty and a core
 * type resolves to nothing — the gate is a no-op until a plugin (or, later, a
 * World-defined type) contributes a schema. `undefined` for an unregistered type,
 * which {@link resolveFields} reads as "no Fields", never a throw.
 */
@Injectable()
export class TypeFieldRegistry {
  private readonly byType = new Map<string, readonly FieldSchema[]>();

  /**
   * Register (or replace) a type's Field schema, validating each declaration through
   * the shared Zod schema so a malformed plugin schema fails loudly at startup, not
   * silently at edit time. Returns an unregister fn, mirroring the web registry.
   */
  register(typeId: string, fields: readonly FieldSchema[]): () => void {
    this.byType.set(
      typeId,
      fields.map((field) => fieldSchemaSchema.parse(field)),
    );
    return () => this.byType.delete(typeId);
  }

  /**
   * The {@link TypeFieldResolver} the domain `resolveFields` unions a `types[]` set through —
   * a single type's declared Fields, or `undefined` for an unregistered type.
   */
  readonly resolver: TypeFieldResolver = (typeId) => this.byType.get(typeId);
}
