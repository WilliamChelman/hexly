import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CANCEL_MOVE_ASSETS, MENU_COMMAND, MOVE_ASSETS, MOVE_ASSETS_PROGRESS, RENEW_SESSION } from './ipc';
// Type-only, so this bundle still carries nothing but the bridge.
import type { AssetMoveProgress, AssetStorageMoveOutcome } from './move-assets';

/**
 * The renderer's only bridge to main. Its *presence* is what the client tests, a capability question rather than
 * a flag read (ADR-0070, ADR-0071), which keeps the same client code working in a browser.
 */
contextBridge.exposeInMainWorld('hexly', {
  /** Resolves once the cookie jar has been rewritten. */
  renewSession: (): Promise<void> => ipcRenderer.invoke(RENEW_SESSION),

  /** The chords these items display are never registered with the OS; the keyboard stays the renderer's (ADR-0070). */
  onMenuCommand: (listener: (commandId: string) => void): (() => void) => {
    const forward = (_event: IpcRendererEvent, commandId: string): void => listener(commandId);
    ipcRenderer.on(MENU_COMMAND, forward);
    return () => void ipcRenderer.off(MENU_COMMAND, forward);
  },

  /**
   * Ask main to move the Asset bytes (#326). Progress rides the same call rather than a separate subscription, so
   * a listener cannot outlive the move it was reporting on.
   */
  moveAssetStorage: (onProgress: (progress: AssetMoveProgress) => void): Promise<AssetStorageMoveOutcome> => {
    const forward = (_event: IpcRendererEvent, progress: AssetMoveProgress): void => onProgress(progress);
    ipcRenderer.on(MOVE_ASSETS_PROGRESS, forward);
    return ipcRenderer.invoke(MOVE_ASSETS).finally(() => void ipcRenderer.off(MOVE_ASSETS_PROGRESS, forward));
  },

  /** The pending `moveAssetStorage` call then resolves as cancelled, having undone its writes. */
  cancelAssetStorageMove: (): void => void ipcRenderer.send(CANCEL_MOVE_ASSETS),
});
