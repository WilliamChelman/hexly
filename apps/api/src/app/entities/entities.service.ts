import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  CreateEntityRequest,
  emptyEntityBody,
  EntityBody,
  entityBodySchema,
  EntityDetail,
  EntitySaveOutcome,
  EntitySummary,
  entityTypeSchema,
  SaveEntityRequest,
  tagsSchema,
  visibilitySchema,
} from '@hexly/domain';
import { and, eq } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { entities } from '../db/schema';

/** The version a freshly created Entity starts at; the first save bumps it to 2. */
const INITIAL_VERSION = 1;

/**
 * The outcome of a save. The `saved`/`conflict` arms are the client-observable
 * {@link EntitySaveOutcome} shared with the web client: `saved` carries the
 * stored Entity at its new version; `conflict` means the base version had moved
 * — `current` is the Entity as it now stands, so the caller can surface a 409
 * and offer a re-pull without a second round trip (ADR-0018). `not-found` is
 * kept api-local: it maps to a 404, not a JSON body, so it stays out of the
 * shared union.
 */
export type SaveResult = EntitySaveOutcome | { status: 'not-found' };

/**
 * The Entity persistence domain behind a small interface (ADR-0018, extending
 * ADR-0002): every Entity is one JSON body on an `entities` row. All access is
 * owner-scoped — the caller passes the authenticated user's id and the service
 * never returns or mutates a row owned by anyone else. Serialization of the body
 * and the optimistic-concurrency `version` bookkeeping live here; callers only
 * handle {@link EntityDetail}/{@link EntitySummary} values.
 */
@Injectable()
export class EntitiesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The owner's Entities as metadata only — the bodies are loaded on open. */
  list(ownerId: string): EntitySummary[] {
    // Select only the summary columns: the `document` TEXT can be large and is
    // discarded by {@link toSummary}, so loading it here is pure waste.
    return this.db
      .select({
        id: entities.id,
        ownerId: entities.ownerId,
        name: entities.name,
        type: entities.type,
        tags: entities.tags,
        visibility: entities.visibility,
        version: entities.version,
        createdAt: entities.createdAt,
        updatedAt: entities.updatedAt,
      })
      .from(entities)
      .where(eq(entities.ownerId, ownerId))
      .all()
      .map(toSummary);
  }

  /**
   * Load one of the owner's Entities in full, or `null` if no such Entity exists
   * *for this owner* — an Entity owned by someone else is indistinguishable from
   * one that does not exist, so ownership never leaks (ADR-0004).
   */
  load(ownerId: string, id: string): EntityDetail | null {
    const row = this.ownedRow(ownerId, id);
    return row ? toDetail(row) : null;
  }

  /** Create an empty Entity of the requested type, owned by `ownerId`, at version 1. */
  create(ownerId: string, req: CreateEntityRequest): EntityDetail {
    const now = Date.now();
    const body = emptyEntityBody(req.type);
    const row = {
      id: randomUUID(),
      ownerId,
      name: req.name,
      type: req.type,
      tags: req.tags,
      visibility: 'private',
      version: INITIAL_VERSION,
      document: serialize(body),
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(entities).values(row).run();
    // We just minted `body` in memory and validated it — return it directly
    // rather than re-parsing the string we serialized from it.
    return detailOf(row, body);
  }

  /**
   * Overwrite the owner's Entity with `req.document`, but only if `req.version`
   * still matches the stored version — otherwise the Entity moved under the
   * caller and the save is a {@link SaveResult conflict} rather than a silent
   * overwrite (ADR-0018, ADR-0004). A successful save bumps the version by one.
   *
   * The version guard is enforced atomically by the SQL: the base version is a
   * predicate in the UPDATE's WHERE clause, so the check and the write are a
   * single statement and a row that moved between read and write cannot slip
   * through. A zero-rows-changed result *is* the conflict.
   */
  save(ownerId: string, id: string, req: SaveEntityRequest): SaveResult {
    // Read first for the not-found case and to carry the columns a save does not
    // touch (name, type, tags, ownerId, createdAt) into the response.
    const row = this.ownedRow(ownerId, id);
    if (!row) return { status: 'not-found' };

    // Set only the columns a save owns (document, version, timestamp) — never
    // the whole row — so a concurrent rename's name is not written back over.
    // The base version in the WHERE clause makes the concurrency check atomic.
    const document = serialize(req.document);
    const version = req.version + 1;
    const updatedAt = Date.now();
    const res = this.db
      .update(entities)
      .set({ document, version, updatedAt })
      .where(
        and(
          eq(entities.id, id),
          eq(entities.ownerId, ownerId),
          eq(entities.version, req.version),
        ),
      )
      .run();
    if (res.changes === 0) {
      // The base version had moved (or the row vanished) between the read and
      // the write: re-read to report the true current state.
      const current = this.ownedRow(ownerId, id);
      return current
        ? { status: 'conflict', current: toDetail(current) }
        : { status: 'not-found' };
    }
    // `req.document` is the validated body we just wrote — return it directly
    // rather than re-parsing and re-validating the string we serialized from it.
    return {
      status: 'saved',
      entity: detailOf({ ...row, version, updatedAt }, req.document),
    };
  }

  /**
   * Rename one of the owner's Entities. Metadata only: it sets the name (and the
   * updated timestamp) and deliberately leaves the body and its `version`
   * untouched, so renaming never invalidates an in-progress edit's base version
   * (and is not itself subject to the body's concurrency check). Returns the
   * updated Entity, or `null` if there is no such Entity for this owner.
   */
  rename(ownerId: string, id: string, name: string): EntityDetail | null {
    const row = this.ownedRow(ownerId, id);
    if (!row) return null;
    const updatedAt = Date.now();
    this.db
      .update(entities)
      .set({ name, updatedAt })
      .where(eq(entities.id, id))
      .run();
    return toDetail({ ...row, name, updatedAt });
  }

  /**
   * Delete one of the owner's Entities. Returns whether a row was actually
   * removed — `false` means there was nothing to delete *for this owner*
   * (unknown id or not theirs), which the caller surfaces as 404.
   */
  delete(ownerId: string, id: string): boolean {
    // A metadata-only ownership check: delete only needs to know the row exists
    // and is this owner's, so it reads just `ownerId` rather than pulling the
    // (potentially large) body through {@link ownedRow}.
    const owner = this.db
      .select({ ownerId: entities.ownerId })
      .from(entities)
      .where(eq(entities.id, id))
      .get();
    if (!owner || owner.ownerId !== ownerId) return false;
    this.db.delete(entities).where(eq(entities.id, id)).run();
    return true;
  }

  /**
   * Fetch a row only if `ownerId` owns it. The single owner-scoping primitive
   * the read/save/delete paths share, so access control lives in one place.
   */
  private ownedRow(
    ownerId: string,
    id: string,
  ): typeof entities.$inferSelect | undefined {
    const row = this.db
      .select()
      .from(entities)
      .where(eq(entities.id, id))
      .get();
    return row && row.ownerId === ownerId ? row : undefined;
  }
}

/** Serialize a body for the `document` text column. */
function serialize(body: EntityBody): string {
  return JSON.stringify(body);
}

/** The metadata columns {@link toSummary} reads — the body-free projection
 * `list` selects, and a structural subset of a full `$inferSelect` row. */
type SummaryRow = Omit<typeof entities.$inferSelect, 'document'>;

/** Project a stored row onto the body-free {@link EntitySummary} metadata. */
function toSummary(row: SummaryRow): EntitySummary {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    // Validate type/visibility against the schema rather than a bare cast: the
    // Zod schema is the single source of truth and both runtimes check against
    // it (ADR-0001).
    type: entityTypeSchema.parse(row.type),
    tags: tagsSchema.parse(row.tags),
    visibility: visibilitySchema.parse(row.visibility),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Rehydrate a stored row into the full {@link EntityDetail} contract. */
function toDetail(row: typeof entities.$inferSelect): EntityDetail {
  return detailOf(row, parseDocument(row.id, row.document));
}

/**
 * Assemble an {@link EntityDetail} from a row's metadata and an already-in-hand
 * body. The write paths (create/save) pass the body they just minted/validated,
 * so they pair {@link toSummary} with it directly and skip re-parsing the
 * serialized `document` — only the read path ({@link toDetail}) pays that cost.
 */
function detailOf(row: SummaryRow, document: EntityBody): EntityDetail {
  return { ...toSummary(row), document };
}

/**
 * Parse and validate a stored body. ADR-0001 makes the Zod schema the single
 * source of truth, so we validate the read path too: a row that fails to parse
 * or schema-validate is exceptional — only reachable via out-of-band corruption
 * or a botched migration — so we throw a descriptive Error naming the row (a
 * clear 500) rather than letting a bare cast crash cryptically deep downstream.
 */
function parseDocument(id: string, document: string): EntityBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(document);
  } catch (cause) {
    throw new Error(
      `Stored entity ${id} has a document that is not valid JSON`,
      { cause },
    );
  }
  const result = entityBodySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Stored entity ${id} has a document that fails the Entity schema`,
      { cause: result.error },
    );
  }
  return result.data;
}
