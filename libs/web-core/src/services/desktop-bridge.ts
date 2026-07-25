import { InjectionToken } from '@angular/core';

/**
 * How far main's copy of the Asset bytes has got (#326). The counters are what finished; `file` is the one in
 * flight, so a surface can name the work rather than only measure it.
 */
export interface AssetStorageMoveProgress {
  readonly file: string;
  readonly copiedFiles: number;
  readonly totalFiles: number;
  readonly copiedBytes: number;
  readonly totalBytes: number;
}

/**
 * How a move of the Asset storage ended. `dismissed` is the user closing the native picker — not a failure and
 * nothing to report; anything but `moved` means the Assets are still exactly where they were. Restated from
 * the shell's own union for the reason the bridge's global name is: no build joins the two bundles.
 */
export type AssetStorageMoveOutcome =
  | { readonly status: 'moved'; readonly to: string; readonly files: number; readonly bytes: number }
  | { readonly status: 'cancelled' }
  | { readonly status: 'dismissed' }
  | { readonly status: 'failed'; readonly reason: string };

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
  /**
   * Move this Instance's Asset bytes: main opens a native folder picker, copies with `onProgress`, verifies
   * every file by hash, rewrites `hexly.yml` and relaunches (ADR-0034 amendment, #326). Resolves with what
   * happened — and on `moved` the relaunch is already coming, so this window is about to go away.
   *
   * A capability, not a setting: only the shell has a picker, a filesystem and a config file to rewrite. Which
   * is why a browser has no such affordance rather than a disabled one (ADR-0071).
   */
  moveAssetStorage(onProgress: (progress: AssetStorageMoveProgress) => void): Promise<AssetStorageMoveOutcome>;
  /** Stop the copy in flight; the `moveAssetStorage` call then resolves `cancelled`, its writes undone. */
  cancelAssetStorageMove(): void;
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
    // the capability. Every member, because one bundle exposes them all — a partial `hexly` is not our shell.
    const members = ['renewSession', 'onMenuCommand', 'moveAssetStorage', 'cancelAssetStorageMove'] as const;
    const complete = !!candidate && members.every((member) => typeof candidate[member] === 'function');
    return complete ? candidate : null;
  },
});
