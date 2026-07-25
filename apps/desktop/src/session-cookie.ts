import type { Cookies } from 'electron';
import { SESSION_COOKIE } from '../../api/src/host';

/**
 * Write a session token into the renderer's cookie jar, before the window loads, so the SPA's first
 * request is already authenticated (ADR-0070). Electron's jar is not the browser's, which is why a web
 * page the user visits can reach this port but holds no token.
 */
export async function writeSessionCookie(jar: Cookies, origin: string, token: string): Promise<void> {
  await jar.set({
    url: origin,
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    // Not `secure`: the origin is plain loopback HTTP, over which a secure cookie is never stored.
    sameSite: 'lax',
    path: '/',
  });
}
