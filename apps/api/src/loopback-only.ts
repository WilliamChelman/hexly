/**
 * The DNS-rebinding wall the Desktop App puts in front of its loopback socket. Rebinding is the one attack
 * that pierces the absence of CORS — an attacker domain resolving to `127.0.0.1` makes the page
 * same-origin — so ADR-0070 closes it at the door instead of resting on the session cookie alone.
 */
import type { IncomingHttpHeaders } from 'node:http';
import type { Socket } from 'node:net';
import type { RequestHandler } from 'express';

/**
 * Reject every caller that did not address the socket by the address it bound. Installed first of all the
 * middleware, so a rebound request reaches neither a controller nor the SPA the same process serves.
 */
export function loopbackOnly(): RequestHandler {
  return (req, res, next) => {
    const authority = boundAuthority(req.socket);
    if (addressesSocket(req.headers, authority)) return next();
    // 403, never 401: a 401 is the one status the client answers by re-minting a session (#321).
    res.status(403).type('text/plain').send(`Hexly answers only callers that address it as ${authority}.\n`);
  };
}

/**
 * The authority a caller must have used to reach this socket — `127.0.0.1:54321` for the Desktop App. Read
 * off the connection, so `listen(0)`'s ephemeral port needs no bookkeeping.
 */
function boundAuthority(socket: Pick<Socket, 'localAddress' | 'localPort'>): string {
  const address = socket.localAddress ?? '';
  // A Host header brackets an IPv6 address (RFC 3986); `localAddress` does not.
  return `${address.includes(':') ? `[${address}]` : address}:${socket.localPort ?? ''}`;
}

/**
 * Whether a caller addressed us as `authority`. An absent `Origin` passes: the window's own navigations,
 * `<img src="/assets/…">` (ADR-0034) and the live-follow `EventSource` (ADR-0044) send none, while a
 * cross-origin page always sends its own.
 */
function addressesSocket(headers: Pick<IncomingHttpHeaders, 'host' | 'origin'>, authority: string): boolean {
  if (headers.host !== authority) return false;
  return headers.origin === undefined || headers.origin === `http://${authority}`;
}
