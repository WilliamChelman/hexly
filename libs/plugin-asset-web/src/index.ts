/**
 * The Asset plugin's Angular half (ADR-0065, ADR-0050): the one provider, {@link providePluginAsset}, that
 * `app.config.ts` names. Kept behind its own entry point so the framework-free half — `@hexly/plugin-asset`,
 * the half the API imports — drags in no Angular.
 */
export { providePluginAsset } from './provide-plugin-asset';
