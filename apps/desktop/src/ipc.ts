/**
 * Channel names the two bundles — main and preload — have to agree on. Shared rather than repeated,
 * because a typo in one of them is silent: `invoke` on an unhandled channel simply rejects.
 */

/** Re-mint the Sole User's session and rewrite the renderer's cookie (ADR-0070). */
export const RENEW_SESSION = 'hexly:renew-session';

/**
 * A native menu item was chosen: main sends the id of the **Command** to invoke, and the renderer's Palette
 * runs it. One-way, main → renderer — the menu is a second surface for a Command, never a second dispatcher
 * (ADR-0070).
 */
export const MENU_COMMAND = 'hexly:menu-command';

/**
 * Move the Asset bytes to a folder the user picks, and relaunch into it (#326). Main's, not the renderer's:
 * it owns the native picker, the filesystem and `hexly.yml`, none of which the SPA can reach.
 */
export const MOVE_ASSETS = 'hexly:move-assets';

/** How far that copy has got, main → renderer, so a surface can hold the user through gigabytes. */
export const MOVE_ASSETS_PROGRESS = 'hexly:move-assets-progress';

/** Cancel the copy in flight. `send`, not `invoke`: there is nothing to answer, and the caller is waiting. */
export const CANCEL_MOVE_ASSETS = 'hexly:cancel-move-assets';
