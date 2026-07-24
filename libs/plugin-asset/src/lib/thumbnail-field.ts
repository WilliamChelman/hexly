/**
 * `core.field.thumbnail` — the canonical **Thumbnail** Field (CONTEXT.md → Thumbnail, ADR-0066): an
 * **Entity Link** to an image **Asset** that any Entity may carry to stand in for itself on tiles and rows
 * (Entity Browser cards, Command Palette results, References). Shipped by the asset plugin the way
 * **Content** ships the prose Field (ADR-0051/0054) — one canonical Field, never a per-type nomination.
 *
 * It is an *entity link*, not a capability URL: the link is the **reference** primitive a typed Field
 * stores, while a served thumbnail URL is the **render** primitive an `<img src>` holds (ADR-0066). The
 * built-in `entityLink` already carries the picker, the write-gate target constraint, and the edge harvest,
 * so no new Data Type and no plugin form-control seam are invented; usage surfaces as an ordinary *named*
 * inbound reference on the target Asset, and a deleted target degrades to a legible dangling label.
 *
 * No Type defaults it — it is attach-on-demand (ADR-0054/0057) via the existing attached-extras machinery;
 * a Type opts in later via ordinary `fieldRefs`. Not `required` (an Entity without a thumbnail falls back to
 * its primary type's icon) and never facetable (a link has no discrete values to count). The materialised
 * derivation that turns a saved designation into a served URL lives at the write choke point (ADR-0045/0066),
 * not here — this file is the declarative registration alone.
 */

import { defineField, type Field } from '@hexly/domain';
import { CORE_ASSET_TYPE_ID } from './asset-type';

/** The Thumbnail Field's namespaced identifier — its `id`, and (ADR-0056) the EntityDocument key it lenses. */
export const CORE_THUMBNAIL_FIELD_ID = 'core.field.thumbnail';

/**
 * The canonical Thumbnail Field (ADR-0066): an `entityLink` constrained to image **Assets**
 * (`targetTypes: ['core.type.asset']`), attach-on-demand and editable through the existing entityLink
 * search picker. `labelKey` carries en/fr copy the web resolves; `label` is the untranslated fallback the
 * API reports.
 */
export const THUMBNAIL_FIELD: Field = defineField({
  id: CORE_THUMBNAIL_FIELD_ID,
  label: 'Thumbnail',
  labelKey: 'asset.field.thumbnail',
  dataType: { kind: 'entityLink', targetTypes: [CORE_ASSET_TYPE_ID] },
  required: false,
  facetable: false,
  // A Thumbnail is a **Decor Link** (ADR-0069): cover art is presentation, not a worldbuilding relation, so
  // its edge is hidden by default on the graph and outbound References. The producer declares decor-ness here.
  decor: true,
});
