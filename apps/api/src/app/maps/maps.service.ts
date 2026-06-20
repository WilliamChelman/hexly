import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  CreateMapRequest,
  emptyHexMap,
  HexMap,
  hexMapSchema,
  MapDetail,
  MapSaveOutcome,
  MapSummary,
  SaveMapRequest,
  visibilitySchema,
} from '@hexly/domain';
import { and, eq } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { maps } from '../db/schema';

/** The version a freshly created map starts at; the first save bumps it to 2. */
const INITIAL_VERSION = 1;

/**
 * The outcome of a save. The `saved`/`conflict` arms are the client-observable
 * {@link MapSaveOutcome} shared with the web client (issue #13): `saved` carries
 * the stored map at its new version; `conflict` means the base version had moved
 * — `current` is the map as it now stands, so the caller can surface a 409 and
 * offer a re-pull without a second round trip (ADR-0002). `not-found` is kept
 * api-local: it maps to a 404, not a JSON body, so it stays out of the shared
 * union.
 */
export type SaveResult = MapSaveOutcome | { status: 'not-found' };

/**
 * The Hex Map persistence domain behind a small interface (ADR-0002): every map
 * is one JSON document on a `maps` row. All access is owner-scoped — the caller
 * passes the authenticated user's id and the service never returns or mutates a
 * row owned by anyone else. Serialization of the document and the
 * optimistic-concurrency `version` bookkeeping live here; callers only handle
 * {@link MapDetail}/{@link MapSummary} values.
 */
@Injectable()
export class MapsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The owner's maps as metadata only — the documents are loaded on open. */
  list(ownerId: string): MapSummary[] {
    // Select only the summary columns: the `document` TEXT can be large and is
    // discarded by {@link toSummary}, so loading it here is pure waste (issue
    // #9).
    return this.db
      .select({
        id: maps.id,
        ownerId: maps.ownerId,
        title: maps.title,
        visibility: maps.visibility,
        version: maps.version,
        createdAt: maps.createdAt,
        updatedAt: maps.updatedAt,
      })
      .from(maps)
      .where(eq(maps.ownerId, ownerId))
      .all()
      .map(toSummary);
  }

  /**
   * Load one of the owner's maps in full, or `null` if no such map exists *for
   * this owner* — a map owned by someone else is indistinguishable from one
   * that does not exist, so ownership never leaks (ADR-0004).
   */
  load(ownerId: string, id: string): MapDetail | null {
    const row = this.ownedRow(ownerId, id);
    return row ? toDetail(row) : null;
  }

  /** Create an empty map owned by `ownerId`, starting at version 1. */
  create(ownerId: string, req: CreateMapRequest): MapDetail {
    const now = Date.now();
    const row = {
      id: randomUUID(),
      ownerId,
      title: req.title,
      visibility: 'private',
      version: INITIAL_VERSION,
      document: serialize(emptyHexMap()),
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(maps).values(row).run();
    return toDetail(row);
  }

  /**
   * Overwrite the owner's map with `req.document`, but only if `req.version`
   * still matches the stored version — otherwise the map moved under the caller
   * and the save is a {@link SaveResult conflict} rather than a silent
   * overwrite (ADR-0002, ADR-0004). A successful save bumps the version by one.
   *
   * The version guard is enforced atomically by the SQL: the base version is a
   * predicate in the UPDATE's WHERE clause, so the check and the write are a
   * single statement and a row that moved between read and write cannot slip
   * through. A zero-rows-changed result *is* the conflict (issue #8).
   */
  save(ownerId: string, id: string, req: SaveMapRequest): SaveResult {
    // Read first for the not-found case and to carry the columns a save does not
    // touch (title, ownerId, createdAt) into the saved/conflict response.
    const row = this.ownedRow(ownerId, id);
    if (!row) return { status: 'not-found' };

    // Set only the columns a save owns (document, version, timestamp) — never
    // the whole row — so a concurrent rename's title is not written back over.
    // The base version in the WHERE clause makes the concurrency check atomic.
    const document = serialize(req.document);
    const version = req.version + 1;
    const updatedAt = Date.now();
    const res = this.db
      .update(maps)
      .set({ document, version, updatedAt })
      .where(
        and(
          eq(maps.id, id),
          eq(maps.ownerId, ownerId),
          eq(maps.version, req.version),
        ),
      )
      .run();
    if (res.changes === 0) {
      // The base version had moved (or the row vanished) between the read and the
      // write: re-read to report the true current state.
      const current = this.ownedRow(ownerId, id);
      return current
        ? { status: 'conflict', current: toDetail(current) }
        : { status: 'not-found' };
    }
    return {
      status: 'saved',
      map: toDetail({ ...row, document, version, updatedAt }),
    };
  }

  /**
   * Rename one of the owner's maps. Metadata only: it sets the title (and the
   * updated timestamp) and deliberately leaves the document and its `version`
   * untouched, so renaming never invalidates an in-progress edit's base version
   * (and is not itself subject to the document's concurrency check). Returns the
   * updated map, or `null` if there is no such map for this owner.
   */
  rename(ownerId: string, id: string, title: string): MapDetail | null {
    const row = this.ownedRow(ownerId, id);
    if (!row) return null;
    const updatedAt = Date.now();
    this.db.update(maps).set({ title, updatedAt }).where(eq(maps.id, id)).run();
    return toDetail({ ...row, title, updatedAt });
  }

  /**
   * Delete one of the owner's maps. Returns whether a row was actually removed
   * — `false` means there was nothing to delete *for this owner* (unknown id or
   * not theirs), which the caller surfaces as 404.
   */
  delete(ownerId: string, id: string): boolean {
    // A metadata-only ownership check: delete only needs to know the row exists
    // and is this owner's, so it reads just `ownerId` rather than pulling the
    // (potentially large) document through {@link ownedRow} (issue #9).
    const owner = this.db
      .select({ ownerId: maps.ownerId })
      .from(maps)
      .where(eq(maps.id, id))
      .get();
    if (!owner || owner.ownerId !== ownerId) return false;
    this.db.delete(maps).where(eq(maps.id, id)).run();
    return true;
  }

  /**
   * Fetch a row only if `ownerId` owns it. The single owner-scoping primitive
   * the read/save/delete paths share, so access control lives in one place.
   */
  private ownedRow(
    ownerId: string,
    id: string,
  ): typeof maps.$inferSelect | undefined {
    const row = this.db.select().from(maps).where(eq(maps.id, id)).get();
    return row && row.ownerId === ownerId ? row : undefined;
  }
}

/** Serialize a document for the `document` text column. */
function serialize(document: HexMap): string {
  return JSON.stringify(document);
}

/** The metadata columns {@link toSummary} reads — the document-free projection
 * `list` selects, and a structural subset of a full `$inferSelect` row. */
type SummaryRow = Omit<typeof maps.$inferSelect, 'document'>;

/** Project a stored row onto the document-free {@link MapSummary} metadata. */
function toSummary(row: SummaryRow): MapSummary {
  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    // Validate visibility against the schema rather than a bare cast: the Zod
    // schema is the single source of truth and both runtimes check against it
    // (ADR-0001).
    visibility: visibilitySchema.parse(row.visibility),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Rehydrate a stored row into the full {@link MapDetail} contract. */
function toDetail(row: typeof maps.$inferSelect): MapDetail {
  return { ...toSummary(row), document: parseDocument(row.id, row.document) };
}

/**
 * Parse and validate a stored document. ADR-0001 makes the Zod schema the single
 * source of truth, so we validate the read path too: a row that fails to parse
 * or schema-validate is exceptional — only reachable via out-of-band corruption
 * or a botched migration — so we throw a descriptive Error naming the row (a
 * clear 500) rather than letting a bare cast crash cryptically deep in the
 * renderer.
 */
function parseDocument(id: string, document: string): HexMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(document);
  } catch (cause) {
    throw new Error(`Stored map ${id} has a document that is not valid JSON`, {
      cause,
    });
  }
  const result = hexMapSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Stored map ${id} has a document that fails the Hex Map schema`,
      { cause: result.error },
    );
  }
  return result.data;
}
