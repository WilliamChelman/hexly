import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateEntityRequest,
  emptyEntityBody,
  EntityBody,
  entityBodySchema,
  EntityDetail,
  EntitySaveOutcome,
  EntitySummary,
  EntityType,
  entityTypeSchema,
  SaveEntityRequest,
  tagsSchema,
  visibilitySchema,
} from '@hexly/domain';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { entities, entityDescriptors, worlds } from '../db/schema';

const INITIAL_VERSION = 1;

/** Owner-scoped paging + filtering options for {@link EntitiesService.list} (ADR-0025). */
export interface ListOptions {
  readonly offset: number;
  readonly limit: number;
  /** Restrict to an explicit id set (owner-scoped); unknown ids drop out silently. */
  readonly ids?: readonly string[];
  /** Case-insensitive substring match on the name. */
  readonly q?: string;
  /** Restrict to one Entity Type. */
  readonly type?: EntityType;
  /** Restrict to one World (ADR-0024). */
  readonly worldId?: string;
}

/** One page of summaries plus whether a further page exists (drives the cursor). */
export interface ListPage {
  readonly items: EntitySummary[];
  readonly hasMore: boolean;
}

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

  /**
   * One owner-scoped page of summaries (ADR-0025), metadata only. Stable sort
   * (newest first, tied by id) prevents overlaps/skips. Reads limit + 1 rows
   * to detect further pages without phantom empty page.
   */
  list(ownerId: string, opts: ListOptions): ListPage {
    // Skip potentially large document column.
    const rows = this.db
      .select({
        id: entities.id,
        ownerId: entities.ownerId,
        worldId: entities.worldId,
        name: entities.name,
        type: entities.type,
        tags: entities.tags,
        visibility: entities.visibility,
        version: entities.version,
        createdAt: entities.createdAt,
        updatedAt: entities.updatedAt,
      })
      .from(entities)
      .where(and(eq(entities.ownerId, ownerId), ...filters(opts)))
      .orderBy(desc(entities.updatedAt), asc(entities.id))
      .limit(opts.limit + 1)
      .offset(opts.offset)
      .all();

    const hasMore = rows.length > opts.limit;
    const items = rows.slice(0, opts.limit).map(toSummary);
    return { items, hasMore };
  }

  /**
   * An Entity owned by someone else is indistinguishable from one that does not
   * exist, so ownership never leaks (ADR-0004).
   */
  load(ownerId: string, id: string): EntityDetail | null {
    const row = this.ownedRow(ownerId, id);
    return row ? toDetail(row) : null;
  }

  create(ownerId: string, req: CreateEntityRequest): EntityDetail {
    const now = Date.now();
    const body = emptyEntityBody(req.type);
    const row = {
      id: randomUUID(),
      ownerId,
      worldId: this.resolveWorldId(ownerId, req.worldId),
      name: req.name,
      type: req.type,
      tags: req.tags,
      visibility: 'private',
      version: INITIAL_VERSION,
      document: serialize(body),
      isHome: false,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(entities).values(row).run();
    // Already have valid body; return without re-parsing.
    return detailOf(row, body);
  }

  /**
   * Version-checked save (ADR-0018, ADR-0004). Concurrent edit is a conflict,
   * not silent overwrite. Guard is atomic: base version in WHERE predicate.
   */
  save(ownerId: string, id: string, req: SaveEntityRequest): SaveResult {
    // Read first for not-found and to preserve untouched columns in response.
    const row = this.ownedRow(ownerId, id);
    if (!row) return { status: 'not-found' };

    // Set only columns a save owns so concurrent renames aren't clobbered.
    // Tags always fully replace (save carries full set, #72).
    const document = serialize(req.document);
    const version = req.version + 1;
    const updatedAt = Date.now();
    // Body write and descriptor-index replace in one transaction (ADR-0023) so
    // index always reflects last-successful-save state, never rejected saves.
    const saved = this.db.transaction(() => {
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
      if (res.changes === 0) return false;
      this.replaceDescriptors(id, req.descriptors);
      return true;
    });
    if (!saved) {
      // Version moved between read and write; re-read to report current state.
      const current = this.ownedRow(ownerId, id);
      return current
        ? { status: 'conflict', current: toDetail(current) }
        : { status: 'not-found' };
    }
    // Return validated body we just wrote directly.
    return {
      status: 'saved',
      entity: detailOf(
        { ...row, version, updatedAt, tags: req.tags },
        req.document,
      ),
    };
  }

  /**
   * Metadata only: leaves body and version untouched so rename doesn't
   * invalidate an in-progress edit's base version.
   */
  rename(ownerId: string, id: string, name: string): EntityDetail | null {
    const row = this.ownedRow(ownerId, id);
    if (!row) return null;
    const updatedAt = Date.now();
    this.db
      .update(entities)
      .set({ name, updatedAt })
      .where(and(eq(entities.id, id), eq(entities.ownerId, ownerId)))
      .run();
    return toDetail({ ...row, name, updatedAt });
  }

  /**
   * Owner's `::` suggestion vocabulary (#96, ADR-0023): DISTINCT Link Descriptors
   * across their entities. Reflects last-saved state (reads the index, not edits).
   */
  listDescriptors(ownerId: string): string[] {
    return this.db
      .selectDistinct({ descriptor: entityDescriptors.descriptor })
      .from(entityDescriptors)
      .innerJoin(entities, eq(entities.id, entityDescriptors.entityId))
      .where(eq(entities.ownerId, ownerId))
      .orderBy(asc(entityDescriptors.descriptor))
      .all()
      .map((row) => row.descriptor);
  }

  /**
   * Replace entity's descriptor rows with harvested set (#96). Self-pruning:
   * dropped descriptors lose rows. Runs in save's transaction on success.
   */
  private replaceDescriptors(id: string, descriptors: readonly string[]): void {
    this.db.delete(entityDescriptors).where(eq(entityDescriptors.entityId, id)).run();
    if (descriptors.length === 0) return;
    this.db
      .insert(entityDescriptors)
      .values(descriptors.map((descriptor) => ({ entityId: id, descriptor })))
      .run();
  }

  // false: unknown id or not owner's (caller surfaces as 404).
  delete(ownerId: string, id: string): boolean {
    const row = this.db
      .select({ ownerId: entities.ownerId, isHome: entities.isHome })
      .from(entities)
      .where(eq(entities.id, id))
      .get();
    if (!row || row.ownerId !== ownerId) return false;
    // 409, not 400: conflicts with World invariant (Home Entity always exists, ADR-0024).
    if (row.isHome) throw new ConflictException('The Home Entity cannot be deleted');
    this.db.delete(entities).where(eq(entities.id, id)).run();
    return true;
  }

  /**
   * Resolve target World for new Entity (ADR-0024). Supplied worldId must be
   * owned by ownerId. Absent worldId defaults to owner's oldest World.
   */
  private resolveWorldId(ownerId: string, requestedId?: string): string {
    const world = this.db
      .select({ id: worlds.id })
      .from(worlds)
      .where(
        requestedId
          ? and(eq(worlds.id, requestedId), eq(worlds.ownerId, ownerId))
          : eq(worlds.ownerId, ownerId),
      )
      .orderBy(asc(worlds.createdAt), asc(worlds.id))
      .get();
    if (!world) throw new NotFoundException('World not found');
    return world.id;
  }

  /**
   * Shared owner-scoping primitive: access control in one place.
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

/**
 * Composable list predicates (ADR-0025). Owner-scoping applied by caller.
 * q: case-insensitive substring. type: exact Entity Type match.
 */
function filters(opts: ListOptions) {
  const predicates = [];
  // Empty id set selects nothing (inArray([]) is always-false).
  if (opts.ids) predicates.push(inArray(entities.id, [...opts.ids]));
  if (opts.q) {
    const escaped = opts.q.replace(/[%_\\]/g, '\\$&');
    predicates.push(sql`${entities.name} LIKE ${'%' + escaped + '%'} ESCAPE '\\'`);
  }
  if (opts.type) predicates.push(eq(entities.type, opts.type));
  if (opts.worldId) predicates.push(eq(entities.worldId, opts.worldId));
  return predicates;
}

function serialize(body: EntityBody): string {
  return JSON.stringify(body);
}

type SummaryRow = Omit<typeof entities.$inferSelect, 'document'>;

function toSummary(row: SummaryRow): EntitySummary {
  return {
    id: row.id,
    ownerId: row.ownerId,
    worldId: row.worldId,
    name: row.name,
    // Validate against schema, not bare cast (ADR-0001).
    type: entityTypeSchema.parse(row.type),
    tags: tagsSchema.parse(row.tags),
    visibility: visibilitySchema.parse(row.visibility),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetail(row: typeof entities.$inferSelect): EntityDetail {
  return detailOf(row, parseDocument(row.id, row.document));
}

// Write paths pass valid body; only toDetail re-parses.
function detailOf(row: SummaryRow, document: EntityBody): EntityDetail {
  return { ...toSummary(row), document, isHome: row.isHome };
}

/**
 * Parse and validate stored body (ADR-0001). Failure is corruption/migration
 * error, so throw descriptive Error naming the row (clear 500).
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
