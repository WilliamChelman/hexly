import { ChipTone } from '../components/chip.component';

/**
 * Sigil helpers — a monogram and a tone per entity/world, so list tiles vary visually without storing
 * a colour or glyph. Keyed by `toneFor`'s categorical set rather than by a hand-rolled list that
 * included `danger` and `success`: those are roles, not colours a tile may wear at random (ADR-0075).
 *
 * The classes are full literal strings because Tailwind only generates classes it can see whole.
 */

/** Sigil chip colours (text + soft fill) per tone. */
export const TONE_SIGIL: Record<ChipTone, string> = {
  accent: 'text-accent-strong bg-accent-soft',
  'tone-1': 'text-tone-1 bg-tone-1-soft',
  'tone-2': 'text-tone-2 bg-tone-2-soft',
  'tone-3': 'text-tone-3 bg-tone-3-soft',
  'tone-4': 'text-tone-4 bg-tone-4-soft',
  'tone-5': 'text-tone-5 bg-tone-5-soft',
  'tone-6': 'text-tone-6 bg-tone-6-soft',
  'tone-7': 'text-tone-7 bg-tone-7-soft',
  'tone-8': 'text-tone-8 bg-tone-8-soft',
};

/** Solid bar per tone (the tile's left edge). */
export const TONE_BAR: Record<ChipTone, string> = {
  accent: 'bg-accent',
  'tone-1': 'bg-tone-1',
  'tone-2': 'bg-tone-2',
  'tone-3': 'bg-tone-3',
  'tone-4': 'bg-tone-4',
  'tone-5': 'bg-tone-5',
  'tone-6': 'bg-tone-6',
  'tone-7': 'bg-tone-7',
  'tone-8': 'bg-tone-8',
};

/** A 1–2 char monogram for a sigil tile. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '·';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
