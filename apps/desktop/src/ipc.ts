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
