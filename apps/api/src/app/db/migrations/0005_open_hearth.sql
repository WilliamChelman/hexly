-- Backfill Home visibility to 'shared' (ADR-0037). A shared World must always have a
-- readable landing page, so new Home Entities are now created locked-shared. Pre-existing
-- Home rows were stored 'private' and became unreadable to members after that change (and
-- the owner can't repair them — the visibility toggle is hidden on the Home). This aligns
-- every old Home with the new locked-shared invariant. Re-running is harmless (idempotent).
UPDATE entities SET visibility = 'shared' WHERE is_home = 1;
