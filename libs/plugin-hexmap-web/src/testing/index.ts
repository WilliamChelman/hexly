export * from '../i18n/test-catalogs';
export * from './entity-session.fake';

/**
 * The map View's real store, for a **host** spec that wants a genuine View editing its session.
 * Test-only: production reaches it through the View's own chunk, never from `@hexly/plugin-hexmap/web`.
 */
export { HexMapStore } from '../services/hexmap-store';
