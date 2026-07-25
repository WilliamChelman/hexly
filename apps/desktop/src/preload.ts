import { contextBridge, ipcRenderer } from 'electron';
import { RENEW_SESSION } from './ipc';

/**
 * The renderer's only bridge to main, one member wide. Its *presence* is what the client tests: "can I
 * re-mint a session?" is a capability question, not a flag read (ADR-0070, ADR-0071), which is also what
 * keeps the same client code working in a browser.
 */
contextBridge.exposeInMainWorld('hexly', {
  /** Ask main for a fresh session; resolves once the cookie jar has been rewritten. */
  renewSession: (): Promise<void> => ipcRenderer.invoke(RENEW_SESSION),
});
