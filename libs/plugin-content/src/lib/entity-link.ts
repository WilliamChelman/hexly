/**
 * A Content Entity Link: an inline reference to another Entity by id, living in prose.
 * `entityId` is the reference; `label` is a snapshot of the target's name at insert
 * time (the dangling fallback); `descriptor` characterises the relationship
 * ("spouse", "capital of"). Two optional Obsidian-wikilink attrs (ADR-0033): `display`
 * is `[[Target|text]]` custom text shown statically in place of the live name;
 * `heading` is a `[[Target#Heading]]` anchor navigation scrolls to.
 */
export interface EntityLinkAttrs {
  entityId: string;
  label: string;
  descriptor?: string | null;
  display?: string | null;
  heading?: string | null;
}

/**
 * The text an `entityLink` renders when its live node view is absent: the static
 * `display` when set, else the stored `label`. Takes a loose attrs bag because callers
 * hold `ContentNode.attrs` (`Record<string, unknown>`).
 *
 * ponytail: if both are null (link inserted before its name resolved) the live DOM
 * may still show a resolved name; rare, unresolved-only — revisit if it bites.
 */
export function entityLinkText(attrs: Record<string, unknown> | null | undefined): string {
  const shown = attrs?.['display'] ?? attrs?.['label'];
  return typeof shown === 'string' ? shown : '';
}
