/**
 * A `namespace.id`'s source label — the picker's filter axis and the data-type cards' badge. A plugin
 * id reads title-cased (`dnd.hexmap` → `Dnd`); shared so datatype choices and Field rows label alike.
 */

/** The `namespace.` of a `namespace.id` (`dnd.hexmap` → `dnd`); a bare id → ''. */
export function namespaceOf(id: string): string {
  return id.includes('.') ? id.slice(0, id.indexOf('.')) : '';
}

/** A `namespace.id`'s source, title-cased (`dnd.hexmap` → `Dnd`); a bare id → ''. */
export function pluginSourceLabel(id: string): string {
  const ns = namespaceOf(id);
  return ns ? ns.charAt(0).toUpperCase() + ns.slice(1) : '';
}
