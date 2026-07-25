import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { MENU_COMMAND, RENEW_SESSION } from './ipc';

/**
 * The renderer's only bridge to main, and deliberately narrow: a capability to re-mint a session, and the
 * native menu's clicks. Its *presence* is what the client tests — "can I re-mint a session?" is a capability
 * question, not a flag read (ADR-0070, ADR-0071) — which is also what keeps the same client code working in a
 * browser.
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
});
