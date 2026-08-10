/**
 * The one accent-fold both the Type and Field sides share (ADR-0056): NFD → strip combining
 * diacritics → lowercase → dash-collapse → trim dashes. Its own copy so the API can derive ids
 * server-side; idempotent, so a re-slug of a slug is the same slug. May return `''`.
 */
export function slugifySegment(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip the combining diacritics NFD split off
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
