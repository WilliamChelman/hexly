import { Field, isFieldViewPlacement, isStructuredDataType, ViewPlacement } from '@hexly/domain';
import { CORE_VIEW_FIELDS } from './view-definition';

/**
 * The **View** order a user-defined type affords (ADR-0050, ADR-0051): its generic Field view, then
 * each **Field of a Structured Data Type** its author chose to show, in declaration order — prose among them, since
 * the `core.rich-content` Content Field is a Field of a Structured Data Type like any other now. A type shipping no
 * code resolves nothing else.
 *
 * Structured Views go last, so adding a battlemap to a `world.deity` does not change what a deity
 * opens on. A plugin type places its Fields' Views by hand and may choose otherwise: `core.hexmap`
 * places its grid first, and opens on its map.
 */
export function userTypeViews(
  fields: readonly Field[],
  isShownAsView: (field: Field) => boolean = () => true,
): ViewPlacement[] {
  return [
    CORE_VIEW_FIELDS,
    ...fields
      .filter((field) => isStructuredDataType(field.dataType) && isShownAsView(field))
      .map((field) => ({ field: field.id })),
  ];
}

/**
 * Whether a type's stored `views` show `field`'s View — what the "Show as a view" toggle reads back.
 * An **absent** list is not an empty one: the author named no order, so every structured Field shows.
 */
export function isShownAsView(views: readonly ViewPlacement[] | undefined, field: Field): boolean {
  if (!views) return true;
  return views.some((view) => isFieldViewPlacement(view) && view.field === field.id);
}
