import { InjectionToken } from '@angular/core';

/**
 * How far main's copy of the Asset bytes has got (#326); `file` is the one in flight. Restated from the
 * shell's `AssetMoveProgress` because no build joins the two bundles.
 */
export interface AssetStorageMoveProgress {
  readonly file: string;
  readonly copiedFiles: number;
  readonly totalFiles: number;
  readonly copiedBytes: number;
  readonly totalBytes: number;
}

/** A code, not a message: this refusal is Hexly's own, and this half of the app holds the catalogues. */
export type AssetStorageMoveRefusal = 'same-folder' | 'nested-folders';

/** Anything but `moved` leaves the Assets exactly where they were; `dismissed` is the user closing the picker. */
export type AssetStorageMoveOutcome =
  | { readonly status: 'moved'; readonly to: string; readonly files: number; readonly bytes: number }
  | { readonly status: 'cancelled' }
  | { readonly status: 'dismissed' }
  | { readonly status: 'refused'; readonly refusal: AssetStorageMoveRefusal }
  | { readonly status: 'failed'; readonly reason: string };

/** The Desktop App's preload bridge, as the renderer sees it — main's whole surface to the client. */
export interface DesktopBridge {
  /** Ask main to re-mint the Sole User's session; resolves once the cookie jar holds the new token. */
  renewSession(): Promise<void>;
  /**
   * Native menu clicks, each carrying a Command id. The chords those items display stay unbound, so the
   * renderer's single dispatcher keeps the keyboard (ADR-0070, ADR-0063). Returns the unsubscribe.
   */
  onMenuCommand(listener: (commandId: string) => void): () => void;
  /**
   * Move this Instance's Asset bytes (ADR-0034 amendment, #326); on `moved` main relaunches, so this window
   * is about to go away. A capability, not a setting — a browser gets no such affordance at all (ADR-0071).
   */
  moveAssetStorage(onProgress: (progress: AssetStorageMoveProgress) => void): Promise<AssetStorageMoveOutcome>;
  /** Stop the copy in flight; the `moveAssetStorage` call then resolves `cancelled`, its writes undone. */
  cancelAssetStorageMove(): void;
}

/**
 * The bridge if this is the Desktop App, `null` in a browser. Its presence is the capability check ADR-0071
 * asks for in place of a flag read; a token so specs can pin either side without installing a global.
 */
export const DESKTOP_BRIDGE = new InjectionToken<DesktopBridge | null>('DESKTOP_BRIDGE', {
  factory: () => {
    // The name `apps/desktop/src/preload.ts` exposes; restated because no build joins the two bundles.
    const candidate = (globalThis as Record<string, unknown>)['hexly'] as DesktopBridge | undefined;
    // Shape-checked, not merely truthy: a page that happens to define `hexly` cannot claim the capability.
    const members = ['renewSession', 'onMenuCommand', 'moveAssetStorage', 'cancelAssetStorageMove'] as const;
    const complete = !!candidate && members.every((member) => typeof candidate[member] === 'function');
    return complete ? candidate : null;
  },
});
