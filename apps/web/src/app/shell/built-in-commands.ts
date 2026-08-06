import { Provider } from '@angular/core';
import { COMMAND_PROVIDERS } from '@hexly/command-palette-web';
import { DiceCommands } from '@hexly/dice-web';
import { CreateCommands } from '../entity-types/create-commands';
import { WorldQuickOpen } from './world-quick-open';
import { NavCommands } from './nav-commands';
import { AssetStorageCommands } from './asset-storage-commands';

/**
 * This app's app-lifetime Command Providers, bound to the palette's {@link COMMAND_PROVIDERS} seam
 * (ADR-0032). The palette lib owns none of these — each lives with its domain (the create Commands
 * under entity-types; World Quick Open and nav under the shell). Listing order is the palette's
 * section order.
 *
 * Entity Quick Open is absent by design: it lives for the World route's lifetime and registers itself
 * there (ADR-0083), which is what leaves the Palette outside a World offering Worlds and Commands
 * alone. Its section follows these, as any contextual Provider's does.
 */
export function provideBuiltInCommands(): Provider[] {
  return [
    { provide: COMMAND_PROVIDERS, useExisting: WorldQuickOpen, multi: true },
    { provide: COMMAND_PROVIDERS, useExisting: CreateCommands, multi: true },
    { provide: COMMAND_PROVIDERS, useExisting: NavCommands, multi: true },
    // Empty in a browser: a shell affordance is a capability, not an entry to disable.
    { provide: COMMAND_PROVIDERS, useExisting: AssetStorageCommands, multi: true },
    // Its own `/r ` prefix, so it never shares a section — listed last for tidiness (ADR-0032).
    { provide: COMMAND_PROVIDERS, useExisting: DiceCommands, multi: true },
  ];
}
