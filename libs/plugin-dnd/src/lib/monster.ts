/**
 * The `dnd.type.monster` bundled Plugin type (CONTEXT.md → Type Definition). A monster references two Fields:
 * its prose `core.field.content` and its `dnd.datatype.stat-block` — the stat block being a **Structured Data Type**
 * now (ADR-0055), one grouped value in the EntityDocument map rather than thirteen scalar keys.
 *
 * The framework-free half, which the API reads. The Angular half is `@hexly/plugin-dnd/web`.
 */

import { defineType } from '@hexly/domain';
import { CONTENT_FIELD } from '@hexly/plugin-content';
import { DND_STAT_BLOCK_FIELD } from './stat-block';

/** The Entity Type id — the namespaced key an Entity carries in its `types[]`. */
export const DND_MONSTER = 'dnd.type.monster';

/**
 * The bundled `dnd.type.monster` type. References its two Fields by id (`fieldRefs`, ADR-0054): the prose
 * `core.field.content` and the `dnd.datatype.stat-block` structured Field. The stat block's harvested dimensions
 * (`size`, `creature_type`, `challenge_rating`) unfold in the Browser's rail by presence (ADR-0054/0055),
 * no longer scalar Fields of the type.
 */
export const DND_MONSTER_TYPE = defineType({
  id: DND_MONSTER,
  label: 'Monster',
  fieldRefs: [CONTENT_FIELD.id, DND_STAT_BLOCK_FIELD.id],
});
