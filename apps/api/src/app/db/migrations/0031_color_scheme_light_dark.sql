-- The ColorScheme is Light and Dark (ADR-0077, #381): both stored surfaces are rewritten in the
-- same breath. Data only — `worlds.theme` and `users.preferences` are JSON text columns, so the
-- schema is untouched and drizzle-kit emits nothing here (cf. migrations 0028, 0029).

-- The World Theme's own ColorScheme keys, at the top level, and its version with them. A version-1
-- payload is refused rather than partly applied (ADR-0076), so the two have to move together.
UPDATE `worlds`
SET `theme` = json_remove(
  json_set(
    `theme`,
    '$.light', json_extract(`theme`, '$.solar'),
    '$.dark', json_extract(`theme`, '$.astral'),
    '$.version', 2
  ),
  '$.solar', '$.astral'
)
WHERE json_extract(`theme`, '$.version') = 1;
--> statement-breakpoint
-- And the same keys under `overrides`, which is optional at both levels. Guarded on the key rather
-- than on the version, as above — the statement above has already moved it, and its presence is what
-- is left to key on; without a guard `json_set` writes a JSON null the schema then refuses.
UPDATE `worlds`
SET `theme` = json_remove(json_set(`theme`, '$.overrides.light', json_extract(`theme`, '$.overrides.solar')), '$.overrides.solar')
WHERE json_type(`theme`, '$.overrides.solar') IS NOT NULL;
--> statement-breakpoint
UPDATE `worlds`
SET `theme` = json_remove(json_set(`theme`, '$.overrides.dark', json_extract(`theme`, '$.overrides.astral')), '$.overrides.astral')
WHERE json_type(`theme`, '$.overrides.astral') IS NOT NULL;
--> statement-breakpoint
-- The roaming Preference, the exact mirror of migration 0029 — which took `theme: light|dark` *to*
-- `colorScheme: solar|astral`. Half of that is undone; the half worth keeping, the `colorScheme`
-- key, stays. That migration's own comment applies verbatim in this direction: without the rewrite
-- `preferencesSchema.strip()` would drop the stale value on the next read and every signed-in
-- reader would silently fall back to their OS preference, which is the one thing this rename was
-- not allowed to change.
UPDATE `users`
SET `preferences` = json_set(
  `preferences`,
  '$.colorScheme',
  CASE json_extract(`preferences`, '$.colorScheme') WHEN 'astral' THEN 'dark' ELSE 'light' END
)
WHERE json_extract(`preferences`, '$.colorScheme') IN ('solar', 'astral');
