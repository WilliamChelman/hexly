import { DestroyRef, EnvironmentProviders, Injectable, inject, provideEnvironmentInitializer } from '@angular/core';
import { DESKTOP_BRIDGE, Logger } from '@hexly/web-core';
import { CommandDirectory } from '@hexly/command-palette-web';

/**
 * The Desktop App's native menu, arriving as Command invocations (ADR-0070): the menu and the Palette share
 * one implementation of every action. Nothing here touches the keyboard — the chords those menu items display
 * are never registered with the OS, so a keydown still reaches the renderer's dispatcher and its suppression
 * rules (ADR-0063).
 */
@Injectable({ providedIn: 'root' })
export class DesktopMenuCommands {
  private readonly bridge = inject(DESKTOP_BRIDGE);
  private readonly commands = inject(CommandDirectory);
  private readonly logger = inject(Logger);

  constructor() {
    // No bridge, no native menu: the capability check ADR-0071 asks for, not a read of the profile.
    if (!this.bridge) return;
    const stop = this.bridge.onMenuCommand((commandId) => {
      // The menu is built at launch and can name a Command nothing offers (a cut list, an unmounted surface).
      if (!this.commands.invoke(commandId)) this.logger.warn(`no Command "${commandId}" to invoke`);
    });
    inject(DestroyRef).onDestroy(stop);
  }
}

/** Listen for the native menu's clicks, alongside the Palette's built-in Providers. */
export function provideDesktopMenuCommands(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => void inject(DesktopMenuCommands));
}
