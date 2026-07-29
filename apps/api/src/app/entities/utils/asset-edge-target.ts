import { sql } from 'drizzle-orm';
import { entityEdges } from '../../db/schema';

/**
 * The Container an edge's target lives in — the one expression every read joins the `(containerId, hash)`
 * Asset dedup index through. An `asset` edge carries its own, read off the URL it was harvested from
 * (ADR-0080); an `entity` edge and a row predating that column fall back to the source's, which is what a
 * World drawing on nothing has always meant.
 */
export const edgeTargetContainerId = sql`coalesce(${entityEdges.targetContainerId}, ${entityEdges.containerId})`;
