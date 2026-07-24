/**
 * Decorative pretty-URL segments: `slugify(name)-base62(uuid)` (ADR-0042).
 *
 * The slug is cosmetic and never parsed; the base62 suffix is the entity/world
 * UUID re-encoded losslessly, so it decodes byte-for-byte back to the canonical
 * id before any API call or guard. Legacy bare-UUID URLs keep resolving forever.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_MAX = 60;

function base62Encode(n: bigint): string {
  if (n === 0n) return '0';
  let s = '';
  while (n > 0n) {
    s = ALPHABET[Number(n % 62n)] + s;
    n /= 62n;
  }
  return s;
}

function base62Decode(s: string): bigint {
  let n = 0n;
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return -1n; // not base62 — caller falls back
    n = n * 62n + BigInt(i);
  }
  return n;
}

function uuidToCode(id: string): string {
  return base62Encode(BigInt('0x' + id.replace(/-/g, '')));
}

function codeToUuid(code: string): string | null {
  const n = base62Decode(code);
  if (n < 0n) return null;
  const hex = n.toString(16).padStart(32, '0');
  if (hex.length > 32) return null; // overflow — not a real 128-bit id
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Total, dependency-free: accent-fold (EN/FR), lowercase, dash-collapse, cap. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
}

/** Build a URL segment. Omits the slug (bare code) when name is empty/absent. */
export function segment(id: string, name?: string): string {
  if (!UUID_RE.test(id)) return id; // not a canonical id — leave untouched, never throw
  const code = uuidToCode(id);
  const slug = name ? slugify(name) : '';
  return slug ? `${slug}-${code}` : code;
}

/**
 * Rewrite the `/w/<seg>/…` World segment of a URL to its canonical `slug-base62`
 * form, preserving the rest of the path, the query, and the fragment. Returns
 * `null` when the URL is not World-scoped or the segment is already canonical
 * (nothing to do). Used by the non-blocking World-slug self-heal (ADR-0042).
 */
export function healWorldSegment(url: string, worldId: string, name: string): string | null {
  const u = new URL(url, 'http://_'); // dummy origin — url is a router path
  const parts = u.pathname.split('/'); // ['', 'w', <seg>, …]
  if (parts[1] !== 'w' || parts.length < 3) return null;
  const pretty = segment(worldId, name);
  if (parts[2] === pretty) return null;
  parts[2] = pretty;
  return parts.join('/') + u.search + u.hash;
}

/** Recover the canonical UUID from a segment. Legacy full-UUID segments pass through. */
export function idFromSegment(seg: string): string {
  if (UUID_RE.test(seg)) return seg; // legacy bare UUID
  const dash = seg.lastIndexOf('-');
  const key = dash >= 0 ? seg.slice(dash + 1) : seg;
  if (UUID_RE.test(key)) return key;
  return codeToUuid(key) ?? seg;
}
