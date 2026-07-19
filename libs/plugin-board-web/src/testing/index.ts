export * from '../i18n/test-catalogs';
export * from './entity-session.fake';

/**
 * The board View's real store, for a **host** spec that wants a genuine View editing its session.
 * Test-only: production reaches it through the View's own chunk, never from `@hexly/plugin-board/web`.
 */
export { BoardStore } from '../services/board-store';
