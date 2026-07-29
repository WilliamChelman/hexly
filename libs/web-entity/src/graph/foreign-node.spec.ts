import { EntityType, WorldGraphNode } from '@hexly/domain';
import { describe, expect, it } from 'vitest';
import { FOREIGN_ALPHA_SCALE, FOREIGN_MARK, nodeLabel } from './foreign-node';
import { GraphColors, pointColors } from './graph-colors';

const NOTE = 'core.type.note' as EntityType;

/** A node of this graph's own World, or — with a Container — one it merely points into. */
function node(id: string, name: string, foreignContainerId?: string): WorldGraphNode {
  return foreignContainerId ? { id, name, types: [NOTE], foreignContainerId } : { id, name, types: [NOTE] };
}

/**
 * One type hue, at a base alpha below 1 and exactly representable as Float32: the assertions then measure
 * the scaling rather than the buffer round-trip, and a scale applied as an absolute would fail.
 */
const COLORS: GraphColors = {
  background: [0, 0, 0, 1],
  byType: new Map([[NOTE, [0.25, 0.5, 0.75, 0.5]]]),
  node: [0.5, 0.5, 0.5, 1],
  link: [0.25, 0.25, 0.25, 1],
  linkHighlight: [1, 0, 0, 1],
  ring: [0, 0, 0, 0.5],
};

/** A **Foreign node** is drawn and marked (ADR-0080), never passed off as one of this World's own. */
describe('the Foreign node mark', () => {
  it('marks a foreign label and leaves a home one exactly as it was', () => {
    expect(nodeLabel(node('ealdred', 'Ealdred'))).toBe('Ealdred');
    expect(nodeLabel(node('goblin', 'Marauder Goblin', 'w-shelf'))).toBe(`${FOREIGN_MARK} Marauder Goblin`);
  });

  it('keeps the Entity Type’s hue and scales its alpha', () => {
    const colors = pointColors([node('ealdred', 'Ealdred'), node('goblin', 'Marauder Goblin', 'w-shelf')], COLORS);

    expect([...colors.slice(0, 4)]).toEqual([0.25, 0.5, 0.75, 0.5]);
    expect([...colors.slice(4, 7)]).toEqual([0.25, 0.5, 0.75]);
    expect(colors[7]).toBeCloseTo(0.5 * FOREIGN_ALPHA_SCALE);
  });
});
