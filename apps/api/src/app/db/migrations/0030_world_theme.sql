-- The Owner-authored World Theme (ADR-0076), stored inline on the World and patched wholesale
-- through PATCH /worlds/:id. NULL is no Theme, which is every existing World.
ALTER TABLE `worlds` ADD `theme` text;