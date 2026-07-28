-- The day/night Preference is a ColorScheme, not a theme (ADR-0075, #360): `theme: light|dark`
-- in the roaming Preferences bag becomes `colorScheme: solar|astral`. Data only — the bag is a
-- JSON text column, so the schema is untouched and drizzle-kit emits nothing here (cf. migration
-- 0028). Without the rewrite `preferencesSchema.strip()` would drop the stale key on the next
-- read and every signed-in reader would silently fall back to their OS preference, which is the
-- one thing the rename was not allowed to change.
UPDATE `users`
SET `preferences` = json_remove(
  json_set(
    `preferences`,
    '$.colorScheme',
    CASE json_extract(`preferences`, '$.theme') WHEN 'dark' THEN 'astral' ELSE 'solar' END
  ),
  '$.theme'
)
WHERE json_extract(`preferences`, '$.theme') IN ('light', 'dark');
