/** Channel names shared rather than repeated across the main and preload bundles: a typo in one is silent. */

/** Re-mint the Sole User's session and rewrite the renderer's cookie (ADR-0070). */
export const RENEW_SESSION = 'hexly:renew-session';

/**
 * A native menu item was chosen: main sends the id of the Command to invoke. The menu is a second surface for a
 * Command, never a second dispatcher (ADR-0070).
 */
export const MENU_COMMAND = 'hexly:menu-command';

/** Move the Asset bytes to a folder the user picks, and relaunch into it (#326). */
export const MOVE_ASSETS = 'hexly:move-assets';

/** How far that copy has got, main → renderer. */
export const MOVE_ASSETS_PROGRESS = 'hexly:move-assets-progress';

/** Cancel the copy in flight. `send`, not `invoke`: there is nothing to answer. */
export const CANCEL_MOVE_ASSETS = 'hexly:cancel-move-assets';
