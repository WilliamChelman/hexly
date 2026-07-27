import { ChipTone } from '../components/chip.component';

/**
 * The eight categorical tones, in rotation order (ADR-0075). `accent` is off the list: it is the
 * through-line accent, so deriving it would make an arbitrary thing look like the primary one.
 */
export const CATEGORICAL_TONES = [
  'tone-1',
  'tone-2',
  'tone-3',
  'tone-4',
  'tone-5',
  'tone-6',
  'tone-7',
  'tone-8',
] as const satisfies readonly ChipTone[];

/**
 * A stable categorical tone for an id — derived, so nothing has to store a colour and the same id
 * looks the same on every run and every machine (ADR-0075).
 */
export function toneFor(id: string): ChipTone {
  return CATEGORICAL_TONES[digest(id) % CATEGORICAL_TONES.length];
}

/**
 * FNV-1a over the id, then murmur3's finaliser. The avalanche is load-bearing: eight tones means a
 * `% 8` bucket that reads only the low three bits, and unmixed those follow the id's last characters —
 * exactly where two plugins' type ids agree (`dnd.type.monster` / `draw-steel.type.monster`).
 */
function digest(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}
