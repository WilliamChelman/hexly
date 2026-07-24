// The config module's public surface: the loaded-config token, its types, and the loader (ADR-0036).
// Consumers outside this directory import from `../config`; `ConfigModule` (the Nest module) is wired
// by its own `./config/config.module` path. The barrel re-exports only `config.ts`, which imports
// nothing from the app graph, so no importer can form a cycle through it.
export * from './config';
