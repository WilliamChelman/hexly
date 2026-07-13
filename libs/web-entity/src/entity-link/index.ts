/**
 * The Entity-Link picker, behind its own entry point: every reader of it is a lazily-loaded View. It
 * cannot sit beside {@link FieldControl} in `controls` — the app shell imports that one eagerly for the
 * create dialog, which would pin this component to the initial bundle.
 */
export { EntityLinkPicker } from './entity-link-picker';
