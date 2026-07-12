export * from '../i18n/test-catalogs';
export * from './entity-session.fake';

/**
 * The map View's real store, for a **host** spec that wants a genuine View editing its session — the
 * app's autosave and save-status specs paint through it, which is the point: they prove the session
 * against a real View, not a stand-in. Production reaches it only through the View's own chunk, so it
 * is exported here rather than from `@hexly/plugin-hexmap/web`, which is one symbol (#199).
 */
export { HexMapStore } from '../web/services/hexmap-store';
