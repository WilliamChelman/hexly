import { DestroyRef, EnvironmentProviders, Injectable, inject, provideEnvironmentInitializer } from '@angular/core';
import { DESKTOP_BRIDGE, Logger } from '@hexly/web-core';
import { CommandDirectory } from '@hexly/command-palette-web';

/**
 * The Desktop App's native menu, arriving as Command invocations (ADR-0070). A menu click carries an id over
 * the preload bridge and this is where it becomes a run — so the menu and the Palette share one
 * implementation of every action.
 *
 * Nothing here touches the keyboard, and that is the point: the chords those menu items display are never
 * registered with the OS, so the keydown still reaches the renderer's single dispatcher and is still
 * suppressed behind an open dialog or while typing (ADR-0063).
 */
@Injectable({ providedIn: 'root' })
export class DesktopMenuCommands {
  private readonly bridge = inject(DESKTOP_BRIDGE);
  private readonly commands = inject(CommandDirectory);
  private readonly logger = inject(Logger);

  constructor() {
    // No bridge, no native menu — the capability check ADR-0071 asks for, rather than a read of the
    // Deployment Profile, and what leaves this inert in a browser.
    if (!this.bridge) return;
    const stop = this.bridge.onMenuCommand((commandId) => {
      // The menu is built at launch and can name a Command that is not on offer (a cut list, an unmounted
      // surface). Said out loud, because the symptom is a menu item that visibly does nothing.
      if (!this.commands.invoke(commandId)) this.logger.warn(`no Command "${commandId}" to invoke`);
    });
    inject(DestroyRef).onDestroy(stop);
  }
}

/** Listen for the native menu's clicks, alongside the Palette's built-in Providers. */
export function provideDesktopMenuCommands(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => void inject(DesktopMenuCommands));
}
