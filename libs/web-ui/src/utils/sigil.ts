/**
 * Sigil helpers — a deterministic accent + monogram per entity/world, so list
 * tiles vary visually without storing a colour or glyph. The accent classes are
 * full literal strings because Tailwind only generates classes it can see whole.
 */
const ACCENTS = ['accent', 'sea', 'astra', 'danger', 'success'] as const;
export type Accent = (typeof ACCENTS)[number];

/** Stable accent for an id (hash → palette index). */
export function accentFor(id: string): Accent {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

/** Sigil chip colours (text + soft fill) per accent. */
export const ACCENT_SIGIL: Record<Accent, string> = {
  accent: 'text-accent bg-accent-soft',
  sea: 'text-sea bg-sea-soft',
  astra: 'text-astra bg-astra-soft',
  danger: 'text-danger bg-danger-soft',
  success: 'text-success bg-success-soft',
};

/** Solid accent bar per accent (the tile's left edge). */
export const ACCENT_BAR: Record<Accent, string> = {
  accent: 'bg-accent',
  sea: 'bg-sea',
  astra: 'bg-astra',
  danger: 'bg-danger',
  success: 'bg-success',
};

/** A 1–2 char monogram for a sigil tile. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '·';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
