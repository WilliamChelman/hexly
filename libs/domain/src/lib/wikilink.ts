/**
 * The Entity name a `[[wikilink]]` label names: its basename, with a `.md` suffix dropped (ADR-0033), so
 * `[[folder/Zorblax.md]]` names *Zorblax*. One rule for both writers of it — the import that mints on a
 * miss and the editor's promotion of an Unresolved Link (ADR-0073) — since two copies drift on exactly
 * the labels neither author thought about.
 *
 * Empty for a label that is no name at all, so a caller offers no mint rather than a blank Entity.
 */
export function wikilinkName(label: string): string {
  // Trailing separators first, so `folder/` names *folder* — how `posix.basename` reads it server-side.
  const path = label.replace(/\/+$/, '');
  return path
    .slice(path.lastIndexOf('/') + 1)
    .replace(/\.md$/i, '')
    .trim();
}
