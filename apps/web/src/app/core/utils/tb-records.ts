import {
  EntityBody,
  EntityDetail,
  EntitySummary,
  EntityType,
  Visibility,
  WorldSummary,
} from '@hexly/domain';
import { EntityRow } from '../models/entity-row';
import { WorldRow } from '../models/world-row';

/**
 * The one place that maps TrailBase wire rows (ADR-0032) to the camelCase domain
 * types — JSON-parsing `document`/`tags` and coercing `is_home` to a boolean, the
 * transforms SQLite's storage types force regardless of column naming.
 */
export function toWorldSummary(row: WorldRow): WorldSummary {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The summary columns the list surface shows — `document` deliberately omitted. */
export function toEntitySummary(row: EntityRow): EntitySummary {
  return {
    id: row.id,
    ownerId: row.owner_id,
    worldId: row.world_id,
    name: row.name,
    type: row.type as EntityType,
    tags: parseJsonArray(row.tags),
    visibility: row.visibility as Visibility,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toEntityDetail(row: EntityRow): EntityDetail {
  return {
    ...toEntitySummary(row),
    document: parseDocument(row.document),
    isHome: row.is_home === 1,
  };
}

/**
 * `entities.document` is a jsonschema-typed JSON column (#130, ADR-0032): TrailBase's
 * Record API returns it already parsed as an object. Tolerate a JSON *string* too — the
 * unit-test fake (and any plain `is_json` TEXT column) hands one back — so the mapping
 * doesn't care which transport produced the row.
 */
function parseDocument(raw: string | EntityBody): EntityBody {
  return typeof raw === 'string' ? (JSON.parse(raw) as EntityBody) : raw;
}

/** `tags` arrives as a JSON string; tolerate a malformed/empty value as no tags. */
function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
