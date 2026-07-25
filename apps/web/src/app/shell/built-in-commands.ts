import { Provider } from '@angular/core';
import { COMMAND_PROVIDERS } from '@hexly/command-palette-web';
import { DiceCommands } from '@hexly/dice-web';
import { EntityQuickOpen } from '../entity-types/entity-quick-open';
import { CreateCommands } from '../entity-types/create-commands';
import { WorldQuickOpen } from './world-quick-open';
import { NavCommands } from './nav-commands';
import { AssetStorageCommands } from './asset-storage-commands';

/**
 * This app's Command Providers, bound to the palette's {@link COMMAND_PROVIDERS} seam (ADR-0032).
 * The palette lib owns none of these — each lives with its domain (Entity Quick Open and the create
 * Commands under entity-types; World Quick Open and nav under the shell). Listing order is the
 * palette's section order.
 */
export function provideBuiltInCommands(): Provider[] {
  return [
    { provide: COMMAND_PROVIDERS, useExisting: EntityQuickOpen, multi: true },
    { provide: COMMAND_PROVIDERS, useExisting: WorldQuickOpen, multi: true },
    { provide: COMMAND_PROVIDERS, useExisting: CreateCommands, multi: true },
    { provide: COMMAND_PROVIDERS, useExisting: NavCommands, multi: true },
    // Empty in a browser: the Desktop App's shell affordances are capabilities, not entries to disable.
    { provide: COMMAND_PROVIDERS, useExisting: AssetStorageCommands, multi: true },
    // Its own `/r ` prefix, so it never shares a section — listed last for tidiness (ADR-0032).
    { provide: COMMAND_PROVIDERS, useExisting: DiceCommands, multi: true },
  ];
}
