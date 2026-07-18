/**
 * The `draw-steel.monster` bundled Plugin type (CONTEXT.md → Type Definition). A monster references two
 * Fields: its prose `core.content` and its `draw-steel.stat-block` — the stat block being a **Structured
 * Data Type** (ADR-0055), one grouped value in the EntityDocument map.
 *
 * The framework-free half, which the API reads. The Angular half is `@hexly/plugin-draw-steel/web`.
 */

import { defineType } from '@hexly/domain';
import { CONTENT_FIELD } from '@hexly/plugin-content';
import { DS_STAT_BLOCK_FIELD } from './stat-block';

/** The Entity Type id — the namespaced key an Entity carries in its `types[]`. */
export const DS_MONSTER = 'draw-steel.monster';

/**
 * The bundled `draw-steel.monster` type. References its two Fields by id (`fieldRefs`, ADR-0054): the
 * prose `core.content` first, then the `draw-steel.stat-block` structured Field — the web places the
 * stat block's View first so a Monster opens on its stats, with the prose behind a Note toggle.
 */
export const DS_MONSTER_TYPE = defineType({
  id: DS_MONSTER,
  label: 'Monster',
  fieldRefs: [CONTENT_FIELD.id, DS_STAT_BLOCK_FIELD.id],
});
