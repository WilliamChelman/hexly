import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  CreateMapRequest,
  emptyHexMap,
  HexMap,
  MapDetail,
  MapSummary,
  SaveMapRequest,
} from '@hexly/domain';
import { eq } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { maps } from '../db/schema';

/** The version a freshly created map starts at; the first save bumps it to 2. */
const INITIAL_VERSION = 1;

/**
 * The outcome of a save. `saved` carries the stored map at its new version;
 * `not-found` means no such map for this owner; `conflict` means the base
 * version had moved — `current` is the map as it now stands, so the caller can
 * surface a 409 and offer a re-pull without a second round trip (ADR-0002).
 */
export type SaveResult =
  | { status: 'saved'; map: MapDetail }
  | { status: 'not-found' }
  | { status: 'conflict'; current: MapDetail };

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
    return this.db
      .select()
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
   */
  save(ownerId: string, id: string, req: SaveMapRequest): SaveResult {
    const row = this.ownedRow(ownerId, id);
    if (!row) return { status: 'not-found' };
    if (row.version !== req.version)
      return { status: 'conflict', current: toDetail(row) };

    // Set only the columns a save owns (document, version, timestamp) — never
    // the whole row — so a concurrent rename's title is not written back over.
    const document = serialize(req.document);
    const version = row.version + 1;
    const updatedAt = Date.now();
    this.db
      .update(maps)
      .set({ document, version, updatedAt })
      .where(eq(maps.id, id))
      .run();
    return { status: 'saved', map: toDetail({ ...row, document, version, updatedAt }) };
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
    if (!this.ownedRow(ownerId, id)) return false;
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

/** Project a stored row onto the document-free {@link MapSummary} metadata. */
function toSummary(row: typeof maps.$inferSelect): MapSummary {
  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    visibility: row.visibility as MapSummary['visibility'],
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Rehydrate a stored row into the full {@link MapDetail} contract. */
function toDetail(row: typeof maps.$inferSelect): MapDetail {
  return { ...toSummary(row), document: JSON.parse(row.document) as HexMap };
}
