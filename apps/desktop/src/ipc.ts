/**
 * Channel names the two bundles — main and preload — have to agree on. Shared rather than repeated,
 * because a typo in one of them is silent: `invoke` on an unhandled channel simply rejects.
 */

/** Re-mint the Sole User's session and rewrite the renderer's cookie (ADR-0070). */
export const RENEW_SESSION = 'hexly:renew-session';
