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
 * The shared {@link EntitySaveOutcome} (`saved`/`conflict`) plus an api-local
 * `not-found` arm that maps to a 404 rather than a JSON body (ADR-0018).
 */
export type SaveResult = EntitySaveOutcome | { status: 'not-found' };

/**
 * Entity persistence: one JSON body per `entities` row (ADR-0018, ADR-0002).
 * All access is owner-scoped — the service never returns or mutates a row owned
 * by anyone else. Body serialization and `version` bookkeeping live here.
 */
@Injectable()
export class EntitiesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The owner's Entities as metadata only — the bodies are loaded on open. */
  list(ownerId: string): EntitySummary[] {
    // Summary columns only — skip the potentially large `document` TEXT.
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
    // `body` is already in hand and valid — return it without re-parsing.
    return detailOf(row, body);
  }

  /**
   * Overwrite the owner's Entity with `req.document`, but only if `req.version`
   * still matches the stored version — otherwise the Entity moved under the
   * caller and the save is a {@link SaveResult conflict} rather than a silent
   * overwrite (ADR-0018, ADR-0004). A successful save bumps the version by one.
   * The guard is atomic: the base version is a WHERE predicate on the UPDATE,
   * so zero rows changed *is* the conflict.
   */
  save(ownerId: string, id: string, req: SaveEntityRequest): SaveResult {
    // Read first for not-found and to carry the untouched columns (name, type,
    // tags, ownerId, createdAt) into the response.
    const row = this.ownedRow(ownerId, id);
    if (!row) return { status: 'not-found' };

    // Set only the columns a save owns, so a concurrent rename isn't clobbered.
    // The save always carries the full tag set, so it always replaces the column (#72).
    const document = serialize(req.document);
    const version = req.version + 1;
    const updatedAt = Date.now();
    const res = this.db
      .update(entities)
      .set({ document, version, updatedAt, tags: req.tags })
      .where(
        and(
          eq(entities.id, id),
          eq(entities.ownerId, ownerId),
          eq(entities.version, req.version),
        ),
      )
      .run();
    if (res.changes === 0) {
      // Base version moved (or row vanished) between read and write — re-read
      // to report the true current state.
      const current = this.ownedRow(ownerId, id);
      return current
        ? { status: 'conflict', current: toDetail(current) }
        : { status: 'not-found' };
    }
    // `req.document` is the validated body we just wrote — return it directly.
    return {
      status: 'saved',
      entity: detailOf(
        { ...row, version, updatedAt, tags: req.tags },
        req.document,
      ),
    };
  }

  /**
   * Rename one of the owner's Entities. Metadata only: leaves the body and its
   * `version` untouched, so a rename never invalidates an in-progress edit's
   * base version. Returns the updated Entity, or `null` if none for this owner.
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
    // Read just `ownerId` for the ownership check — no need to pull the body.
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
   * Fetch a row only if `ownerId` owns it — the shared owner-scoping primitive,
   * so access control lives in one place.
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

/** A stored row without its `document` body — what `list` selects. */
type SummaryRow = Omit<typeof entities.$inferSelect, 'document'>;

/** Project a stored row onto the body-free {@link EntitySummary} metadata. */
function toSummary(row: SummaryRow): EntitySummary {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    // Validate against the schema (single source of truth) not a bare cast (ADR-0001).
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
 * Assemble an {@link EntityDetail} from a row's metadata and an in-hand body.
 * Write paths pass the body they just minted; only {@link toDetail} re-parses.
 */
function detailOf(row: SummaryRow, document: EntityBody): EntityDetail {
  return { ...toSummary(row), document };
}

/**
 * Parse and validate a stored body (ADR-0001). A row that fails is exceptional
 * — corruption or a botched migration — so throw a descriptive Error naming the
 * row (a clear 500) rather than letting a bare cast crash deeper downstream.
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
