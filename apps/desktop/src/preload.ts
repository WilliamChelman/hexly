import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CANCEL_MOVE_ASSETS, MENU_COMMAND, MOVE_ASSETS, MOVE_ASSETS_PROGRESS, RENEW_SESSION } from './ipc';
// Type-only, so this bundle still carries nothing but the bridge: the shapes main sends over the two channels.
import type { AssetMoveProgress, AssetStorageMoveOutcome } from './move-assets';

/**
 * The renderer's only bridge to main, and deliberately narrow: a capability to re-mint a session, the native
 * menu's clicks, and moving the Asset storage. Its *presence* is what the client tests — "can I re-mint a
 * session?" is a capability question, not a flag read (ADR-0070, ADR-0071) — which is also what keeps the same
 * client code working in a browser.
 */
contextBridge.exposeInMainWorld('hexly', {
  /** Ask main for a fresh session; resolves once the cookie jar has been rewritten. */
  renewSession: (): Promise<void> => ipcRenderer.invoke(RENEW_SESSION),

  /**
   * Subscribe to native menu clicks, each naming a Command to invoke. The keyboard stays the renderer's: the
   * chords those items display are never registered with the OS (ADR-0070).
   */
  onMenuCommand: (listener: (commandId: string) => void): (() => void) => {
    const forward = (_event: IpcRendererEvent, commandId: string): void => listener(commandId);
    ipcRenderer.on(MENU_COMMAND, forward);
    return () => void ipcRenderer.off(MENU_COMMAND, forward);
  },

  /**
   * Ask main to move the Asset bytes: it opens the native folder picker, copies, verifies each file by hash,
   * rewrites `hexly.yml` and relaunches (#326). Progress rides the same call rather than a separate
   * subscription, so a listener cannot outlive the move it was reporting on.
   */
  moveAssetStorage: (onProgress: (progress: AssetMoveProgress) => void): Promise<AssetStorageMoveOutcome> => {
    const forward = (_event: IpcRendererEvent, progress: AssetMoveProgress): void => onProgress(progress);
    ipcRenderer.on(MOVE_ASSETS_PROGRESS, forward);
    return ipcRenderer.invoke(MOVE_ASSETS).finally(() => void ipcRenderer.off(MOVE_ASSETS_PROGRESS, forward));
  },

  /** Stop the copy in flight. The `moveAssetStorage` call then resolves as cancelled, having undone its writes. */
  cancelAssetStorageMove: (): void => void ipcRenderer.send(CANCEL_MOVE_ASSETS),
});
