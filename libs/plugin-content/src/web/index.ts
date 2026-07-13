/**
 * The Content plugin's Angular half (ADR-0051): the {@link ContentEditor} and its chrome, the shared
 * {@link EntityNameResolver}, and the {@link CONTENT_EDITOR_SESSION} the host provides. Kept behind its
 * own entry point so the framework-free half — `@hexly/plugin-content` — drags in no Angular or TipTap.
 *
 * The editor's translation scope stays behind `@hexly/plugin-content/i18n` (ADR-0049): `app.config.ts`
 * registers it eagerly, and reaching it through this barrel would pull TipTap onto the initial bundle.
 */
export * from './content-editor';
export * from './content-editor-session';
export * from './entity-name-resolver';
