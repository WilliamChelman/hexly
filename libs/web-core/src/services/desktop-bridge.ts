import { InjectionToken } from '@angular/core';

/** The Desktop App's preload bridge, as the renderer sees it — main's whole surface to the client. */
export interface DesktopBridge {
  /** Ask main to re-mint the Sole User's session; resolves once the cookie jar holds the new token. */
  renewSession(): Promise<void>;
  /**
   * Listen for the native menu's clicks, each carrying the id of a **Command** to invoke. The chords those
   * items display stay unbound, so the renderer's single dispatcher keeps ownership of the keyboard
   * (ADR-0070, ADR-0063); this channel only carries the click. Returns the unsubscribe.
   */
  onMenuCommand(listener: (commandId: string) => void): () => void;
}

/**
 * The bridge if this is the Desktop App, `null` in a browser. Its *presence* is the capability check
 * ADR-0071 asks for in place of a flag read, and a token so specs can pin either side rather than
 * install a global.
 */
export const DESKTOP_BRIDGE = new InjectionToken<DesktopBridge | null>('DESKTOP_BRIDGE', {
  factory: () => {
    // The name `contextBridge.exposeInMainWorld` uses in `apps/desktop/src/preload.ts`; restated because
    // the preload bundle is Electron's and this is the SPA's, and no build joins them.
    const candidate = (globalThis as Record<string, unknown>)['hexly'] as DesktopBridge | undefined;
    // Shape-checked member by member, not merely truthy: a page that happens to define `hexly` cannot claim
    // the capability. Both members, because one bundle exposes them — a partial `hexly` is not our shell.
    const complete = typeof candidate?.renewSession === 'function' && typeof candidate.onMenuCommand === 'function';
    return complete ? candidate : null;
  },
});
