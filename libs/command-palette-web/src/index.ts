/**
 * The Command Palette (ADR-0032): the Cmd/Ctrl+K overlay plus the Provider seam it renders through.
 * Concrete Command Providers live with their domain and register via {@link COMMAND_PROVIDERS};
 * this lib owns none of them. The `commandPalette` scope ships from the `/i18n` entry (ADR-0049).
 */
export * from './command';
export * from './command-registry';
export * from './command-palette.component';
