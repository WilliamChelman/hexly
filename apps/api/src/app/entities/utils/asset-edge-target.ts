import { sql } from 'drizzle-orm';
import { entityEdges } from '../../db/schema';

/**
 * The Container an edge's target lives in — the one expression every read joins the `(containerId, hash)`
 * Asset dedup index through. An `asset` edge carries its own, read off the URL it was harvested from
 * (ADR-0080); an `entity` edge falls back to the source's, which is what a World drawing on nothing has
 * always meant. So does the residue migration 0040's backfill could not recover — a legacy row whose URL
 * named a Container this Instance no longer holds, and which therefore resolves nowhere either way.
 */
export const edgeTargetContainerId = sql`coalesce(${entityEdges.targetContainerId}, ${entityEdges.containerId})`;
