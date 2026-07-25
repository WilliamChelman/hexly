ALTER TABLE `asset_index` ADD `ext` text;--> statement-breakpoint
-- Backfill below this line, hand-authored: drizzle-kit emits schema, not data (cf. migration 0003). The
-- dedup index gains the `ext` half of the byte address (#325), and without it every existing Asset would
-- read as "presence unknown" until its next save or Reindex — leaving the users who most need the
-- missing-bytes state (they moved `assets.dir`, which rewrites no index rows) told nothing at all. The
-- asset-ref key is spelled out because a migration is frozen history, not live code: the derivation that
-- owns this mapping is `harvestAssetRef` on `core.datatype.asset`, and it is what keeps the column true
-- from here on. A row whose document has no such key stays NULL, which reads as unknown, never as missing.
UPDATE `asset_index` SET `ext` = (
  SELECT json_extract(`entities`.`document`, '$."core.field.asset".ext')
  FROM `entities` WHERE `entities`.`id` = `asset_index`.`entity_id`
) WHERE `ext` IS NULL;
