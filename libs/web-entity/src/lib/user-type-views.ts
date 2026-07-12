import { FieldSchema, isFieldViewPlacement, isStructuredDataType, ViewPlacement } from '@hexly/domain';
import { CORE_VIEW_CONTENT, CORE_VIEW_FIELDS } from './view-definition';

/**
 * The **View** order a user-defined type affords (ADR-0050, #201): its Fields, then its Content, then
 * each **Structured Field** its author chose to show — in declaration order.
 *
 * The whole of what a World Owner can place, and the one place that list is spelled. A user-defined
 * type ships no code, so it can resolve only the generic Field view, the Content view every Entity
 * affords, and the Views its own structured Fields bring; there is nothing else for it to order.
 *
 * Fields first, and the map last, because that is what the author made the type *for*: adding a
 * battlemap to a `world.deity` must not hijack how a deity presents itself. A plugin type places its
 * Fields' Views by hand and can choose otherwise — `core.hexmap` places its grid first, and opens on
 * its map. Same list, same resolution; only the author differs.
 *
 * Its two callers are the two directions of the same fact: the **World Types editor** composes the
 * list a "Show as a view" toggle authors, and the **loader** composes the default for a type whose
 * author never named an order (every type predating the toggle).
 */
export function userTypeViews(
  fields: readonly FieldSchema[],
  isShownAsView: (field: FieldSchema) => boolean = () => true,
): ViewPlacement[] {
  return [
    CORE_VIEW_FIELDS,
    CORE_VIEW_CONTENT,
    ...fields
      .filter((field) => isStructuredDataType(field.dataType) && isShownAsView(field))
      .map((field) => ({ field: field.key })),
  ];
}

/**
 * Whether a type's stored `views` show `field`'s View — what the editor's "Show as a view" toggle
 * reads back. An **absent** list is not an empty one: it means the author never named an order, so
 * every structured Field is shown, which is the toggle's default (on).
 */
export function isShownAsView(views: readonly ViewPlacement[] | undefined, field: FieldSchema): boolean {
  if (!views) return true;
  return views.some((view) => isFieldViewPlacement(view) && view.field === field.key);
}
