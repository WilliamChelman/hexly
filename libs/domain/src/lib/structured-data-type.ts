/**
 * The **Structured Field**'s data-type — the plugin-contributed member of the Field data-type set
 * (CONTEXT.md → Structured Field, ADR-0050).
 *
 * A built-in data-type (`string`, `number`, `list`, an `entityLink`…) is a form control over a small
 * value. A structured one is a *document*: a value with its own schema, its own link-edge harvesting,
 * and (later) its own View — a Hex Map's grid at the `grid` key, contributed by `core.hex-grid`. It is
 * declared here, framework-free, because both halves consume it: the API validates and harvests it,
 * the web renders it.
 *
 * Two rules give the open set its shape.
 *
 * **A data-type is structured _iff_ its kind is a `namespace.id` id** — no boolean flag declares it,
 * exactly as an Entity Type is namespaced. So the *shape* of a kind is validated in the domain (a
 * typo with no dot, `strig`, is rejected where the Field is declared) while its *membership* is
 * resolved in the host: `defineType()` runs at module load, so a schema enumerating the known
 * structured kinds could not validate the very plugin registering one. A well-formed but unregistered
 * kind (`core.hex-gird`) therefore fails at **resolution**, against the set the host composes.
 *
 * **The set is threaded explicitly, never global.** {@link validateFields} and {@link harvestEdges}
 * take a {@link StructuredDataTypeSet} as a parameter, exactly as `harvestEdges` already takes the
 * resolved Fields. The domain grows no mutable registry, so import order cannot change behaviour and
 * a test passes its own set.
 */

import { z } from 'zod';
import type { EntityEdge } from './entity-edges';

/**
 * A structured data-type's id: a `namespace.id` key (`core.hex-grid`), mirroring the Entity Type
 * keyspace. The template-literal type is what makes "structured" a *narrowable* fact about a kind —
 * no built-in kind (`string`, `entityLink`) carries a dot, so the two are disjoint at the type level.
 */
export type StructuredDataTypeId = `${string}.${string}`;

const NAMESPACED_ID = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/;

export const structuredDataTypeIdSchema = z.custom<StructuredDataTypeId>(
  // Exact, never trimmed: the id is a *key* — the one a Field's `kind` is looked up under — so
  // tolerating ` core.hex-grid ` here would register a data-type that could never be resolved.
  (value) => typeof value === 'string' && NAMESPACED_ID.test(value),
  { message: 'A structured data-type must be a `namespace.id` key' },
);

/**
 * One registered structured data-type, as the domain consumes it — type-erased over its value, so a
 * heterogeneous set of them fits in one map. {@link defineStructuredDataType} is the typed
 * constructor a plugin actually calls; it is what closes over the value type.
 */
export interface StructuredDataType {
  readonly id: StructuredDataTypeId;
  /** The value's shape. The forward-only gate rides it, and a garbage value at rest simply fails it. */
  readonly valueSchema: z.ZodType;
  /** A fresh empty value — a Hex Map's untouched plane, an empty timeline. */
  empty(): unknown;
  /**
   * The Entity Links this value expresses (a Hex's `entityId`, a Region's), harvested into the edge
   * index alongside the Content's. Absent when the data-type carries no links. Never throws on a
   * malformed value: {@link defineStructuredDataType} parses first and yields no edges if it fails.
   */
  harvestEdges?(value: unknown): readonly EntityEdge[];
}

/**
 * Declare a structured data-type — the constructor a plugin's framework-free half goes through, the
 * peer of `defineType()`. A malformed id (`strig` — no namespace) throws at module load rather than
 * at runtime.
 *
 * The declared `harvestEdges` sees a *parsed* value, so a plugin writes it against its own type and
 * never against `unknown`; a value that does not inhabit `valueSchema` yields no edges, which is the
 * forward-only tolerance the write path needs — an at-rest document this build cannot parse is
 * skipped, never a 500.
 */
export function defineStructuredDataType<T>(definition: {
  readonly id: string;
  readonly valueSchema: z.ZodType<T>;
  readonly empty: () => T;
  readonly harvestEdges?: (value: T) => readonly EntityEdge[];
}): StructuredDataType {
  const id = structuredDataTypeIdSchema.parse(definition.id);
  const { valueSchema, empty, harvestEdges } = definition;
  return Object.freeze<StructuredDataType>({
    id,
    valueSchema: valueSchema as z.ZodType,
    empty,
    ...(harvestEdges && {
      harvestEdges: (value: unknown) => {
        const parsed = valueSchema.safeParse(value);
        return parsed.success ? harvestEdges(parsed.data) : [];
      },
    }),
  });
}

/**
 * The resolved structured data-type set a host composes and threads into the domain — the API from
 * its bundled plugins, the web from `providePlugin()`, a test from whatever it declares itself.
 */
export type StructuredDataTypeSet = ReadonlyMap<string, StructuredDataType>;

/** The empty set: what a caller with no structured data-types in play passes (and every one does today). */
export const NO_STRUCTURED_DATA_TYPES: StructuredDataTypeSet = new Map();

/** Compose a set from the declarations a host bundles. A duplicate id is a build error, not a silent win. */
export function structuredDataTypeSet(dataTypes: readonly StructuredDataType[]): StructuredDataTypeSet {
  const set = new Map<string, StructuredDataType>();
  for (const dataType of dataTypes) {
    if (set.has(dataType.id)) throw new Error(`Duplicate structured data-type: ${dataType.id}`);
    set.set(dataType.id, dataType);
  }
  return set;
}
