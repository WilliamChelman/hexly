/**
 * The Entity-Link picker, behind its own entry point because every reader of it is a lazily-loaded
 * **View** (the Hex Map's Inspector today, any link-carrying slot tomorrow). It cannot sit beside
 * {@link FieldControl} in `controls`: the app shell imports that one to build the create dialog, and a
 * re-export next to it would pin this component to the initial bundle for a screen that never shows it.
 */
export { EntityLinkPicker } from './entity-link-picker';
