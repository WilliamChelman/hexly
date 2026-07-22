import { Field, isFieldViewPlacement, isStructuredDataType, ViewPlacement } from '@hexly/domain';

/**
 * The **View** order a user-defined type affords (ADR-0050, ADR-0051, ADR-0067): each **Field of a
 * Structured Data Type** its author chose to show, in declaration order — prose among them, since the
 * `core.datatype.rich-content` Content Field is a Field of a Structured Data Type like any other now.
 *
 * The Details View is **no longer** placed here (ADR-0067): it is the fallback alone, appended by
 * {@link TypeRegistry.viewsFor} only when a type affords no other View — so a deity that grows a
 * battlemap opens on that battlemap, never on a "Details" toggle sitting beside it. A type with only
 * scalar Fields therefore places nothing and falls to the full-width Details View. A plugin type places
 * its Fields' Views by hand: `core.type.hex-map` places its grid, and opens on its map.
 */
export function userTypeViews(
  fields: readonly Field[],
  isShownAsView: (field: Field) => boolean = () => true,
): ViewPlacement[] {
  return fields
    .filter((field) => isStructuredDataType(field.dataType) && isShownAsView(field))
    .map((field) => ({ field: field.id }));
}

/**
 * Whether a type's stored `views` show `field`'s View — what the "Show as a view" toggle reads back.
 * An **absent** list is not an empty one: the author named no order, so every structured Field shows.
 */
export function isShownAsView(views: readonly ViewPlacement[] | undefined, field: Field): boolean {
  if (!views) return true;
  return views.some((view) => isFieldViewPlacement(view) && view.field === field.id);
}
