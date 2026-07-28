import { ChipTone, toneFor } from '@hexly/web-ui';
import { DesignToken } from '@hexly/web-styles';
import { TypeDefinition } from './type-definition';

/** The tone an Entity Type wears: the one it pinned, else the one its id derives (ADR-0075). */
export function typeTone(def: Pick<TypeDefinition, 'id' | 'tone'>): ChipTone {
  return def.tone ?? toneFor(def.id);
}

/**
 * The token the World Graph paints this type's nodes with. A type that names one has opted out of the
 * categorical set; every other type paints its own tone, so a chip and a node agree by construction
 * rather than by two declarations staying in sync (ADR-0075).
 */
export function typeColorToken(def: Pick<TypeDefinition, 'id' | 'tone' | 'graphColorToken'>): DesignToken {
  return def.graphColorToken ?? `--color-${typeTone(def)}`;
}
