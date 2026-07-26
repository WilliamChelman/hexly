/**
 * The name an Unresolved Link mints under when promoted (ADR-0073). Its `label` is a wikilink target
 * verbatim, so it may carry a folder path or a `.md` suffix: `[[folder/Zorblax]]` names *Zorblax*,
 * exactly as the same link names it when import mints instead (`vault-import.service.ts`).
 *
 * Empty for a label that is no name at all — the caller offers no promotion rather than a blank Entity.
 */
export function promotedName(label: string): string {
  return (label.split('/').pop() ?? '').replace(/\.md$/i, '').trim();
}
