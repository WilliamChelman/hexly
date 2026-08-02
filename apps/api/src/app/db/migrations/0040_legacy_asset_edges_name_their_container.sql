-- Hand-authored data backfill: drizzle-kit emits schema, not data (cf. migration 0028). Migration 0036
-- added `entity_edges.target_container_id` nullable with nothing to fill it, so on an upgraded Instance
-- every asset edge harvested before that day carries NULL — and `coalesce(target_container_id,
-- container_id)` reads NULL as "the source's own Container". A picture drawn from elsewhere therefore
-- went missing from the blast-radius count and from the Vault export's foreign bytes, and resolved to the
-- source's own twin wherever it held the same bytes. Reindex rebuilds these rows, but it is
-- Superadmin-initiated: an upgrade may not depend on someone remembering to run it (ADR-0080, #407).
--
-- The edge row alone cannot say — it stores the hash, never the URL — but the document it was harvested
-- from still can, and `/assets/<containerId>/<hash>` is a literal substring of it. So the candidates come
-- from `containers` and the document is only ever *tested*, never parsed: a Container is named here only
-- because the source document spells its URL out. Nothing is inferred from the hash, which names bytes and
-- not an Asset, and a URL naming a Container this Instance no longer holds stays NULL — mis-attribution
-- would be worse than the row it replaced. Costs one `instr` per (legacy asset edge × Container), once.

-- One legacy row can stand for two Assets: edges dedup on (kind, target, descriptor), and before 0036 the
-- target was the bare hash, so a document embedding the same bytes from two Containers harvested a single
-- row. Split those off first — the rows this build's harvest would have written — leaving the lowest-id
-- match to the UPDATE below. No row can collide: a save since the upgrade replaces an Entity's edges
-- wholesale, so a source with a NULL asset edge has no stamped one.
INSERT INTO `entity_edges` (`source_entity_id`, `container_id`, `target_kind`, `target_id`, `target_container_id`, `descriptor`, `decor`)
SELECT `e`.`source_entity_id`, `e`.`container_id`, 'asset', `e`.`target_id`, `c`.`id`, `e`.`descriptor`, `e`.`decor`
FROM `entity_edges` `e`
JOIN `entities` `s` ON `s`.`id` = `e`.`source_entity_id`
JOIN `containers` `c` ON instr(`s`.`document`, '/assets/' || `c`.`id` || '/' || `e`.`target_id`) > 0
WHERE `e`.`target_kind` = 'asset'
  AND `e`.`target_container_id` IS NULL
  AND `c`.`id` > (
    SELECT min(`c2`.`id`) FROM `containers` `c2`
    WHERE instr(`s`.`document`, '/assets/' || `c2`.`id` || '/' || `e`.`target_id`) > 0
  );--> statement-breakpoint
-- Stamp every remaining legacy row with the Container its URL named. `IS NULL` is the whole of the
-- idempotency: a row this build wrote is already right and is never read, and a re-run finds only the
-- unresolvable rows, whose `min()` over no match is NULL again.
UPDATE `entity_edges` SET `target_container_id` = (
  SELECT min(`c`.`id`) FROM `containers` `c`
  JOIN `entities` `s` ON `s`.`id` = `entity_edges`.`source_entity_id`
  WHERE instr(`s`.`document`, '/assets/' || `c`.`id` || '/' || `entity_edges`.`target_id`) > 0
)
WHERE `target_kind` = 'asset' AND `target_container_id` IS NULL;
