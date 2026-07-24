-- The live-follow freshness key (ADR-0045). `seq` is a per-resource monotonic counter bumped by
-- every committed change, whatever its kind — substance, exposure, sharing, lifecycle — so a nudge
-- shrinks to `{ id, seq }` and neither `version` (a concurrency token) nor `updatedAt` (a
-- user-visible timestamp) is dragged onto the wire to serve as one.
--
-- `ADD COLUMN` (not a table rebuild) keeps every entities rowid, so the external-content FTS index
-- (migration 0002) stays aligned without recreating its triggers. Existing rows start at 1: nothing
-- is in production, and a follower's held `seq` is seeded by the read that opened its follow.
ALTER TABLE `entities` ADD `seq` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `worlds` ADD `seq` integer DEFAULT 1 NOT NULL;