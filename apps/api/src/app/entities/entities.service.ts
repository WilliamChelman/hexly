import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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
   * One owner-scoped page of summaries (ADR-0025) — metadata only, bodies are
   * loaded on open. The sort is stable and deterministic (newest first,
   * tiebroken by id) so cursor paging never overlaps or skips. Reads `limit + 1`
   * rows to know whether a further page exists without a phantom empty page.
   */
  list(ownerId: string, opts: ListOptions): ListPage {
    // Summary columns only — skip the potentially large `document` TEXT.
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
    // `body` is already in hand and valid — return it without re-parsing.
    return detailOf(row, body);
  }

  /**
   * Version-checked save: only if `req.version` matches the stored version,
   * so a concurrent edit is a {@link SaveResult conflict} rather than a silent
   * overwrite (ADR-0018, ADR-0004). Guard is atomic: base version is a WHERE
   * predicate on the UPDATE, so zero rows changed *is* the conflict.
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
    // The body write and the descriptor-index replace ride one transaction (ADR-0023):
    // a stale-version save changes nothing — neither the body nor the vocabulary — so the
    // index always reflects last-*successful*-save state, never an in-flight or rejected one.
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
   * Metadata only: leaves the body and its `version` untouched, so a rename
   * never invalidates an in-progress edit's base version.
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
   * The owner's `::` suggestion vocabulary (#96, ADR-0023): every DISTINCT Link
   * Descriptor across their entities, sorted for a stable suggestion order. Reflects
   * last-saved state by design — it reads the index the save path maintains, never a
   * snapshot's live edits.
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
   * Replace one entity's descriptor rows with the harvested set (#96) — the
   * self-pruning step: a descriptor the save no longer carries loses its row and stops
   * being suggested. Runs inside {@link save}'s transaction, only on a successful write.
   */
  private replaceDescriptors(id: string, descriptors: readonly string[]): void {
    this.db.delete(entityDescriptors).where(eq(entityDescriptors.entityId, id)).run();
    if (descriptors.length === 0) return;
    this.db
      .insert(entityDescriptors)
      .values(descriptors.map((descriptor) => ({ entityId: id, descriptor })))
      .run();
  }

  /** `false` means nothing to delete for this owner (unknown id or not theirs); caller surfaces as 404. */
  delete(ownerId: string, id: string): boolean {
    const row = this.db
      .select({ ownerId: entities.ownerId, isHome: entities.isHome })
      .from(entities)
      .where(eq(entities.id, id))
      .get();
    if (!row || row.ownerId !== ownerId) return false;
    if (row.isHome) throw new BadRequestException('The Home Entity cannot be deleted');
    this.db.delete(entities).where(eq(entities.id, id)).run();
    return true;
  }

  /**
   * Resolve the target World for a new Entity (ADR-0024). When the client
   * supplies a worldId, it must be owned by ownerId (contributor access is a
   * future concern). When absent, defaults to the owner's oldest World.
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

/**
 * The composable list predicates (ADR-0025) — owner-scoping is applied by the
 * caller, never here. `q` is a case-insensitive substring match (SQLite `LIKE`
 * folds ASCII case by default); `type` is an exact Entity Type match.
 */
function filters(opts: ListOptions) {
  const predicates = [];
  // An empty id set selects nothing (inArray([]) is always-false), not everything.
  if (opts.ids) predicates.push(inArray(entities.id, [...opts.ids]));
  if (opts.q) {
    const escaped = opts.q.replace(/[%_\\]/g, '\\$&');
    predicates.push(sql`${entities.name} LIKE ${'%' + escaped + '%'} ESCAPE '\\'`);
  }
  if (opts.type) predicates.push(eq(entities.type, opts.type));
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
    // Validate against the schema (single source of truth) not a bare cast (ADR-0001).
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

/** Write paths pass the body they just minted; only {@link toDetail} re-parses. */
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
