/**
 * The kinded id keyspace (ADR-0064): every registered `namespace.kind.name` id carries its kind as the
 * middle segment, so an id self-classifies on sight and no two families can collide. A dependency-free
 * leaf, like `field-id.ts`, so every schema module can share the shape without import cycles.
 *
 * Enforcement is on *definitions* only — Entity Document keys stay open (a bare foreign key no Field
 * lenses flows through unvalidated), and built-in data-type kinds (`string`, `number`) stay bare: bare
 * vs. kinded is itself the built-in/structured marker.
 */

/** The closed middle-segment vocabulary (ADR-0064). Extending it is an ADR-level decision, not a convenience. */
export type IdKind = 'type' | 'field' | 'datatype' | 'view' | 'importer';

/** A registered id of kind `K`: `namespace.kind.name`, every segment kebab-case. */
export type KindedId<K extends IdKind> = `${string}.${K}.${string}`;

/** The `namespace.kind.name` shape for one kind — exactly three kebab-case segments. */
export function kindedIdRegex(kind: IdKind): RegExp {
  return new RegExp(`^[a-z0-9-]+\\.${kind}\\.[a-z0-9-]+$`);
}
