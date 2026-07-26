import { ChipTone } from '@hexly/web-ui';
import { TypeDefinition } from './type-definition';

/**
 * The eight categorical tones, in rotation order (ADR-0075). `accent` is off the list on purpose: it
 * is the through-line accent, so deriving it would make an arbitrary type look like the primary one.
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
 * The tone an Entity Type is painted with: the one it {@link TypeDefinition.tone declares}, else a
 * deterministic function of its id (ADR-0075).
 *
 * Derived rather than assigned so no registry, plugin load order, or install set can move a type's
 * colour — a World's chips look the same on the next run and on someone else's machine. The explicit
 * declaration is what stops two plugins silently sharing a tone: one of them pins its own.
 */
export function typeTone(def: Pick<TypeDefinition, 'id' | 'tone'>): ChipTone {
  return def.tone ?? CATEGORICAL_TONES[digest(def.id) % CATEGORICAL_TONES.length];
}

/**
 * FNV-1a over the id, then murmur3's finaliser. The avalanche is not ceremony: there are eight tones,
 * so the bucket is `% 8` and reads only the low three bits — and without a final mix those bits of an
 * FNV hash are dominated by the id's last characters, which is exactly where two plugins' type ids
 * agree (`dnd.type.monster` / `draw-steel.type.monster`).
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
